import {
  _decorator,
  Component,
  Node,
  UITransform,
  instantiate,
  Prefab,
  EventTouch,
  Vec3,
  math,
  Mask,
  Vec2,
  tween,
  Tween,
  input,
  Input,
  Enum,
  UIOpacity,
} from 'cc';
import { VScrollViewItem } from './VScrollViewItem';
import { IProps, TweenMgr } from './samples/script/TweenMgr';
const { ccclass, property, menu } = _decorator;

class InternalNodePool {
  private pools: Map<number, Node[]> = new Map();
  private prefabs: Prefab[] = [];

  /**
   * 构造函数：根据传入的预制体数组初始化不同类型的节点池。
   * @param prefabs 不同类型的预制体数组
   */
  constructor(prefabs: Prefab[]) {
    this.prefabs = prefabs;
    prefabs.forEach((_, index) => {
      this.pools.set(index, []);
    });
  }

  /**
   * 从指定类型的池中获取一个节点。若池为空则实例化一个新的节点。
   * @param typeIndex 预制体类型索引
   * @returns Node 实例（可能是新建的或复用的）
   */
  get(typeIndex: number): Node {
    const pool = this.pools.get(typeIndex);
    if (!pool) {
      console.error(`[VScrollView NodePool] 类型 ${typeIndex} 不存在`);
      return null;
    }
    if (pool.length > 0) {
      const node = pool.pop()!;
      node.active = true;
      return node;
    }
    const newNode = instantiate(this.prefabs[typeIndex]);
    return newNode;
  }

  /**
   * 将节点放回对应类型的池中以供复用；若类型不存在则销毁节点。
   * @param node 要回收的节点
   * @param typeIndex 节点对应的类型索引
   */
  put(node: Node, typeIndex: number) {
    if (!node) return;
    const pool = this.pools.get(typeIndex);
    if (!pool) {
      console.error(`[VScrollView NodePool] 类型 ${typeIndex} 不存在`);
      node.destroy();
      return;
    }
    node.active = false;
    node.removeFromParent();
    pool.push(node);
  }

  /**
   * 清空所有池并销毁其中的节点。
   */
  clear() {
    this.pools.forEach(pool => {
      pool.forEach(node => node.destroy());
      pool.length = 0;
    });
    this.pools.clear();
  }

  /**
   * 获取当前每个类型池中剩余节点数量的统计信息（仅用于调试）。
   */
  getStats() {
    const stats: any = {};
    this.pools.forEach((pool, type) => {
      stats[`type${type}`] = pool.length;
    });
    return stats;
  }
}

export type RenderItemFn = (node: Node, index: number) => void;
export type ProvideNodeFn = () => Node;
export type OnItemClickFn = (node: Node, index: number) => void;
export type PlayItemEnterAnimationFn = (node: Node, index: number) => void;
export type PlayItemAppearAnimationFn = (node: Node, index: number) => void;
export type GetItemHeightFn = (index: number) => number;
export type GetItemTypeIndexFn = (index: number) => number;

export enum ScrollDirection {
  VERTICAL = 0, //纵向滑动
  HORIZONTAL = 1,  //横向滑动
}
export enum EnterAnimationType {
  NONE = 0, //没有默认动画
  TOP,    //自下往上进场
  BOTTOM, //自上往下进场
  Left,   //自右往左进场
  RIGHT,  //自左往右进场
}

@ccclass('VScrollView')
@menu('2D/VScrollView(虚拟滚动列表)')
export class VScrollView extends Component {
  @property({ type: Node, displayName: '容器节点', tooltip: 'content 容器节点（在 Viewport 下）' })
  public content: Node | null = null;

  @property({ displayName: '启用虚拟列表', tooltip: '是否启用虚拟列表模式（关闭则仅提供滚动功能）', })
  public useVirtualList: boolean = true;

  @property({ type: Enum(ScrollDirection), displayName: '滚动方向', tooltip: '滚动方向：纵向（向上）或横向（向左）', })
  public direction: ScrollDirection = ScrollDirection.VERTICAL;

  @property({
    type: Enum(EnterAnimationType), displayName: '进场动画', tooltip: '右滑或上滑;None为空,可playItemEnterAnimationFn自定义实现',
    visible(this: VScrollView) {
      return this.useVirtualList
    },
  })
  public enterAnimationType: EnterAnimationType = EnterAnimationType.NONE;


  @property({
    type: Prefab, displayName: '子项预制体', tooltip: '可选：从 Prefab 创建 item（等大小模式）',
    visible(this: VScrollView) {
      return this.useVirtualList && !this.useDynamicSize;
    },
  })
  public itemPrefab: Prefab | null = null;

  @property({
    displayName: '不等高/宽模式', tooltip: '启用不等高/宽模式',
    visible(this: VScrollView) {
      return this.useVirtualList;
    },
  })
  public useDynamicSize: boolean = false;

  @property({
    type: [Prefab], displayName: '子项预制体数组', tooltip: '不等大小模式：预先提供的子项预制体数组（可在编辑器拖入）',
    visible(this: VScrollView) {
      return this.useVirtualList && this.useDynamicSize;
    },
  })
  public itemPrefabs: Prefab[] = [];

  @property({
    displayName: '行/列数', tooltip: '纵向模式为列数，横向模式为行数', range: [1, 10, 1],
    visible(this: VScrollView) {
      return this.useVirtualList && !this.useDynamicSize;
    },
  })
  public gridCount: number = 1;

  @property({
    displayName: '副方向间距', tooltip: '主方向垂直方向的间距（像素）', range: [0, 1000, 1],
    visible(this: VScrollView) {
      return this.useVirtualList && !this.useDynamicSize;
    },
  })
  public gridSpacing: number = 8;

  @property({
    displayName: '主方向间距', tooltip: '主方向的间距（像素）', range: [0, 1000, 1],
    visible(this: VScrollView) {
      return this.useVirtualList;
    },
  })
  public spacing: number = 8;



  @property({
    displayName: '额外缓冲', tooltip: '额外缓冲（可视区外多渲染几条，避免边缘复用闪烁）', range: [0, 10, 1],
    visible(this: VScrollView) {
      return this.useVirtualList;
    },
  })
  public buffer: number = 1;

  @property({ displayName: '像素对齐', tooltip: '是否启用像素对齐' })
  public pixelAlign: boolean = true;


  public renderItemFn: RenderItemFn | null = null;
  public provideNodeFn: ProvideNodeFn | null = null;
  public onItemClickFn: OnItemClickFn | null = null;

  public getItemHeightFn: GetItemHeightFn | null = null; // 获取指定索引的高度（不等高模式）
  public getItemTypeIndexFn: GetItemTypeIndexFn | null = null; // 获取指定索引对应的 prefab 类型索引

  private totalCount: number = 0;
  private _viewportSize = 0;
  private _contentSize = 0;
  private itemMainSize: number = 100; //单项滚动方向上的尺寸
  private itemCrossSize: number = 100; // 单项副方向上的尺寸
  private _boundsMin = 0; // 滚动最小值
  private _boundsMax = 0; //滚动最大值

  private _slotNodes: Node[] = []; // 插槽节点数组（用于复用显示的 item 节点）
  private _slots = 0; // 插槽数量（池中持有的节点数）
  private _slotFirstIndex = 0; // 当前第一个插槽对应的数据索引
  private _slotPrefabIndices: number[] = []; // 每个插槽当前使用的 prefab 类型索引


  private _itemSizes: number[] = []; // 每个数据项在主方向的尺寸（不等高模式）
  private _prefixPositions: number[] = []; // 前缀和数组：每个项在 content 中的起始位置（不等高模式）
  private _prefabSizeCache: Map<number, number> = new Map(); // 预制体尺寸缓存（按类型索引）
  private _nodePool: InternalNodePool | null = null; // 节点池，用于不等高模式的 prefab 复用
  private _initSortLayerFlag: boolean = true; // 是否初始化时为子项开启渲染排序层级
  private _tmpMoveVec2 = new Vec2(); // 临时 Vec2 对象，避免频繁创建（用于 touch delta）

  private _enterAnimateIndices: Set<number> = new Set(); // 进场动画。局限于首次进场视图内的的索引集合
  private _needAnimateIndices: Set<number> = new Set(); // 需要播放出场动画的索引集合（新增项）
  public playItemEnterAnimationFn: PlayItemEnterAnimationFn | null = null; // 子项进场动画回调(只有进场首次执行refreshList后才会回调)
  public playItemAppearAnimationFn: PlayItemAppearAnimationFn | null = null; // 仅在子项出场动画回调(新出现的都会回调,不限时机)



  /** 获取 content 的 UITransform。 */
  private get _contentTf(): UITransform {
    this.content = this._getContentNode();
    return this.content!.getComponent(UITransform)!;
  }

  /** 获取视口（viewport）的 UITransform。*/
  private get _viewportTf(): UITransform {
    return this.node.getComponent(UITransform)!;
  }

  /** 获取或创建 content 节点引用并返回。*/
  private _getContentNode(): Node {
    if (!this.content) {
      this.content = this.node.getChildByName('content');
    }
    return this.content;
  }

  /**
   * 判断当前是否为纵向滚动模式。
   * @returns true 表示纵向，false 表示横向
   */
  private _isVertical(): boolean {
    return this.direction === ScrollDirection.VERTICAL;
  }

  /**  获取视口在主方向上的尺寸（纵向为 height，横向为 width）。 */
  private _getViewportMainSize(): number {
    return this._isVertical() ? this._viewportTf.height : this._viewportTf.width;
  }

  /** 获取 content 在主方向上的位置（纵向取 y，横向取 x）。*/
  private _getContentMainPos(): number {
    return this._isVertical() ? this.content!.position.y : this.content!.position.x;
  }

  /**
   * 设置 content 在主方向上的位置
   * @param pos 目标位置
   */
  private _setContentMainPos(pos: number) {
    if (!Number.isFinite(pos)) return;
    if (this.pixelAlign) pos = Math.round(pos);
    const p = this.content!.position;
    if (this._isVertical()) {
      if (pos === p.y) return;
      this.content!.setPosition(p.x, pos, p.z);
    } else {
      if (pos === p.x) return;
      this.content!.setPosition(pos, p.y, p.z);
    }
  }

  private init() {
    this.content = this._getContentNode();
    if (!this.content) return;
    const mask = this.node.getComponent(Mask);
    if (!mask) console.warn('[VirtualScrollView] 建议在视窗节点挂一个 Mask 组件用于裁剪');
    this.gridCount = Math.max(1, Math.round(this.gridCount));
    if (!this.useVirtualList) {
      this._viewportSize = this._getViewportMainSize();
      this._contentSize = this._isVertical() ? this._contentTf.height : this._contentTf.width;
      if (this._isVertical()) {
        this._boundsMin = 0;
        this._boundsMax = Math.max(0, this._contentSize - this._viewportSize);
      } else {
        this._boundsMin = -Math.max(0, this._contentSize - this._viewportSize);
        this._boundsMax = 0;
      }
      this._bindTouch();
      this._bindGlobalTouch();
      return;
    }
    this.content.removeAllChildren();
    this._viewportSize = this._getViewportMainSize();
    if (this.useDynamicSize) this._initDynamicSizeMode();
    else this._initFixedSizeMode();
    this._bindTouch();
    this._bindGlobalTouch();
  }

  /** 初始化等高模式：创建插槽并基于 itemPrefab 或 provideNodeFn 进行节点实例化。*/
  private _initFixedSizeMode() {
    if (!this.provideNodeFn) {
      this.provideNodeFn = () => {
        if (this.itemPrefab) return instantiate(this.itemPrefab);
        console.warn('[VirtualScrollView] 没有提供 itemPrefab');
        const n = new Node('item-auto-create');
        const size = this._isVertical() ? this._viewportTf.width : this._viewportTf.height;
        n.addComponent(UITransform).setContentSize(this._isVertical() ? size : this.itemMainSize, this._isVertical() ? this.itemMainSize : size);
        return n;
      };
    }
    let item_pre = this.provideNodeFn();
    const uit = item_pre.getComponent(UITransform);
    if (this._isVertical()) {
      this.itemMainSize = uit.height;
      this.itemCrossSize = uit.width;
    } else {
      this.itemMainSize = uit.width;
      this.itemCrossSize = uit.height;
    }
    this._recomputeContentSize();
    const stride = this.itemMainSize + this.spacing;
    const visibleLines = Math.ceil(this._viewportSize / stride);
    this._slots = Math.max(1, (visibleLines + this.buffer + 2) * this.gridCount);
    for (let i = 0; i < this._slots; i++) {
      const n = instantiate(item_pre);
      n.parent = this.content!;
      this._slotNodes.push(n);
    }
    this._slotFirstIndex = 0;
    this._layoutSlots(this._slotFirstIndex, true);
  }

  /** 更新总条目数，并根据模式调整内部数据结构与插槽。*/
  private upTotalCount(count: number) {
    if (this._viewportSize == 0) {
      this.init();
    }
    if (!this.useVirtualList) {
      console.warn('[VScrollView] 非虚拟列表模式，不支持 setTotalCount');
      return;
    }
    const oldCount = this.totalCount;
    this.totalCount = Math.max(0, count | 0);
    if (this.totalCount > oldCount) {
      for (let i = oldCount; i < this.totalCount; i++) {
        this._needAnimateIndices.add(i);
      }
    }
    if (this._enterAnimateIndices.size == 0) {
      this._enterAnimateIndices.add(-1)
      const stride = this.itemMainSize + this.spacing;
      const visibleNum = Math.ceil(this._viewportSize / stride) * this.gridCount
      for (let i = 0; i < visibleNum; i++) {
        this._enterAnimateIndices.add(i)
      }
    }
    if (this.useDynamicSize) {
      const oldLength = this._itemSizes.length;
      if (this.totalCount > oldLength) {
        for (let i = oldLength; i < this.totalCount; i++) {
          let size = 100;
          if (this.getItemHeightFn) {
            size = this.getItemHeightFn(i);
          } else if (this.getItemTypeIndexFn && this._prefabSizeCache.size > 0) {
            const typeIndex = this.getItemTypeIndexFn(i);
            size = this._prefabSizeCache.get(typeIndex) || 100;
          }
          this._itemSizes.push(size);
        }
      } else if (this.totalCount < oldLength) {
        this._itemSizes.length = this.totalCount;
      }
      this._buildPrefixSum();
      if (this.totalCount > oldCount) this._expandSlotsIfNeeded();
    } else {
      this._recomputeContentSize();
    }
    this._slotFirstIndex = math.clamp(this._slotFirstIndex, 0, Math.max(0, this.totalCount - 1));
    this._updateVisible(true);
  }

  /** 根据当前滚动位置计算新的首个插槽索引，并执行插槽复用或完整布局更新。*/
  private _updateVisible(force: boolean) {
    if (!this.useVirtualList) return;
    let scrollPos = this._getContentMainPos();
    let searchPos: number;
    if (this._isVertical()) {
      searchPos = math.clamp(scrollPos, 0, this._contentSize);
    } else {
      searchPos = math.clamp(-scrollPos, 0, this._contentSize);
    }

    let newFirst = 0;
    if (this.useDynamicSize) {
      const range = this._calcVisibleRange(searchPos);
      newFirst = range.start;
    } else {
      const stride = this.itemMainSize + this.spacing;
      const firstLine = Math.floor(searchPos / stride);
      const first = firstLine * this.gridCount;
      newFirst = math.clamp(first, 0, Math.max(0, this.totalCount - 1));
    }
    if (this.totalCount < this._slots) newFirst = 0;
    if (force) {
      this._slotFirstIndex = newFirst;
      this._layoutSlots(this._slotFirstIndex, true);
      return;
    }
    const diff = newFirst - this._slotFirstIndex;
    if (diff === 0) return;
    if (Math.abs(diff) >= this._slots) {
      this._slotFirstIndex = newFirst;
      this._layoutSlots(this._slotFirstIndex, true);
      return;
    }
    const absDiff = Math.abs(diff);
    if (diff > 0) {
      const moved = this._slotNodes.splice(0, absDiff);
      this._slotNodes.push(...moved);
      if (this.useDynamicSize && this._slotPrefabIndices.length > 0) {
        const movedIndices = this._slotPrefabIndices.splice(0, absDiff);
        this._slotPrefabIndices.push(...movedIndices);
      }
      this._slotFirstIndex = newFirst;
      for (let i = 0; i < absDiff; i++) {
        const slot = this._slots - absDiff + i;
        const idx = this._slotFirstIndex + slot;
        if (idx >= this.totalCount) {
          const node = this._slotNodes[slot];
          if (node) node.active = false;
        } else {
          this._layoutSingleSlot(this._slotNodes[slot], idx, slot);
        }
      }
    } else {
      const moved = this._slotNodes.splice(this._slotNodes.length + diff, absDiff);
      this._slotNodes.unshift(...moved);
      if (this.useDynamicSize && this._slotPrefabIndices.length > 0) {
        const movedIndices = this._slotPrefabIndices.splice(this._slotPrefabIndices.length + diff, absDiff);
        this._slotPrefabIndices.unshift(...movedIndices);
      }
      this._slotFirstIndex = newFirst;
      for (let i = 0; i < absDiff; i++) {
        const idx = this._slotFirstIndex + i;
        if (idx >= this.totalCount) {
          const node = this._slotNodes[i];
          if (node) node.active = false;
        } else {
          this._layoutSingleSlot(this._slotNodes[i], idx, i);
        }
      }
    }
  }

  /** 根据首索引遍历并布局所有插槽（将调用 _layoutSingleSlot）。*/
  private _layoutSlots(firstIndex: number, forceRender: boolean) {
    if (!this.useVirtualList) return;
    for (let s = 0; s < this._slots; s++) {
      const idx = firstIndex + s;
      const node = this._slotNodes[s];
      if (idx >= this.totalCount) {
        if (node) node.active = false;
      } else {
        this._layoutSingleSlot(node, idx, s);
      }
    }
  }

  /** 布局单个插槽：在等高或不等高模式下创建/复用节点并设置位置与尺寸。 */
  private async _layoutSingleSlot(node: Node | null, idx: number, slotIdx: number) {
    if (!this.useVirtualList) return;
    if (this.useDynamicSize) {
      let targetPrefabIndex = this.getItemTypeIndexFn(idx);
      const currentPrefabIndex = this._slotPrefabIndices[slotIdx];
      let newNode: Node | null = null;
      if (currentPrefabIndex === targetPrefabIndex && this._slotNodes[slotIdx]) {
        newNode = this._slotNodes[slotIdx];
      } else {
        if (this._slotNodes[slotIdx] && this._nodePool && currentPrefabIndex >= 0) {
          this._nodePool.put(this._slotNodes[slotIdx], currentPrefabIndex);
        }
        if (this._nodePool) {
          newNode = this._nodePool.get(targetPrefabIndex);
          if (!newNode) {
            console.error(`[VScrollView] 无法获取类型 ${targetPrefabIndex} 的节点`);
            return;
          }
          newNode.parent = this.content;
          this._slotNodes[slotIdx] = newNode;
          this._slotPrefabIndices[slotIdx] = targetPrefabIndex;
        }
      }
      if (!newNode) {
        console.error(`[VScrollView] 槽位 ${slotIdx} 节点为空，索引 ${idx}`);
        return;
      }
      newNode.active = true;
      this._updateItemClickHandler(newNode, idx);
      if (this.renderItemFn) this.renderItemFn(newNode, idx);
      if (this.getItemHeightFn) {
        const expectedSize = this.getItemHeightFn(idx);
        if (this._itemSizes[idx] !== expectedSize) {
          this.updateItemHeight(idx, expectedSize);
          return;
        }
      } else {
        const uit = newNode.getComponent(UITransform);
        const actualSize = this._isVertical() ? uit?.height || 100 : uit?.width || 100;
        if (Math.abs(this._itemSizes[idx] - actualSize) > 1) {
          this.updateItemHeight(idx, actualSize);
          return;
        }
      }
      const uit = newNode.getComponent(UITransform);
      const size = this._itemSizes[idx];
      const itemStart = this._prefixPositions[idx];
      if (this._isVertical()) {
        const anchorY = uit?.anchorY ?? 0.5;
        const anchorOffsetY = size * (1 - anchorY);
        const nodeY = itemStart + anchorOffsetY;
        const y = -nodeY;
        newNode.setPosition(0, this.pixelAlign ? Math.round(y) : y);
      } else {
        // 修改：横向模式下，itemStart 是正值，但 content.x 是负值
        // 所以 item 的 x 位置应该直接使用 itemStart（因为 content 整体向左移动）
        const anchorX = uit?.anchorX ?? 0.5;
        const anchorOffsetX = size * anchorX;
        const nodeX = itemStart + anchorOffsetX;
        // 不需要取负，因为 content 本身已经是负值了
        const x = nodeX;
        newNode.setPosition(this.pixelAlign ? Math.round(x) : x, 0);
      }
      this.checkPlayItemAnimation(idx, newNode)
    } else {
      if (!node) return;
      node.active = true;
      const stride = this.itemMainSize + this.spacing;
      const line = Math.floor(idx / this.gridCount);
      const gridPos = idx % this.gridCount;
      const uit = node.getComponent(UITransform);
      const itemStart = line * stride;
      if (this._isVertical()) {
        const anchorY = uit?.anchorY ?? 0.5;
        const anchorOffsetY = this.itemMainSize * (1 - anchorY);
        const nodeY = itemStart + anchorOffsetY;
        const y = -nodeY;
        const totalWidth = this.gridCount * this.itemCrossSize + (this.gridCount - 1) * this.gridSpacing;
        const x = gridPos * (this.itemCrossSize + this.gridSpacing) - totalWidth / 2 + this.itemCrossSize / 2;
        node.setPosition(this.pixelAlign ? Math.round(x) : x, this.pixelAlign ? Math.round(y) : y);
        if (uit) {
          uit.width = this.itemCrossSize;
          uit.height = this.itemMainSize;
        }
      } else {
        const anchorX = uit?.anchorX ?? 0.5;
        const anchorOffsetX = this.itemMainSize * anchorX;
        const nodeX = itemStart + anchorOffsetX;
        const x = nodeX;
        const totalHeight = this.gridCount * this.itemCrossSize + (this.gridCount - 1) * this.gridSpacing;
        const y = totalHeight / 2 - gridPos * (this.itemCrossSize + this.gridSpacing) - this.itemCrossSize / 2;
        node.setPosition(this.pixelAlign ? Math.round(x) : x, this.pixelAlign ? Math.round(y) : y);
        if (uit) {
          uit.width = this.itemMainSize;
          uit.height = this.itemCrossSize;
        }
      }
      this._updateItemClickHandler(node, idx);
      if (this.renderItemFn) this.renderItemFn(node, idx);
      this.checkPlayItemAnimation(idx, node)

    }
  }

  /**  更新或初始化子项的点击处理器与索引信息。*/
  private _updateItemClickHandler(node: Node, index: number) {
    if (!this.useVirtualList) return;
    let itemScript = node.getComponent(VScrollViewItem);
    if (!itemScript) itemScript = node.addComponent(VScrollViewItem);
    this._initSortLayerFlag ? itemScript.onSortLayer() : itemScript.offSortLayer();
    itemScript.useItemClickEffect = this.onItemClickFn ? true : false;
    if (!itemScript.onClickCallback) {
      itemScript.onClickCallback = (idx: number) => {
        if (this.onItemClickFn) this.onItemClickFn(node, idx);
      };
    }
    itemScript.setDataIndex(index);
  }

  /** 根据当前配置和总条目数重新计算 content 大小并设置边界。 */
  private _recomputeContentSize() {
    if (!this.useVirtualList) {
      this._contentSize = this._isVertical() ? this._contentTf.height : this._contentTf.width;
      if (this._isVertical()) {
        this._boundsMin = 0;
        this._boundsMax = Math.max(0, this._contentSize - this._viewportSize);
      } else {
        this._boundsMin = -Math.max(0, this._contentSize - this._viewportSize);
        this._boundsMax = 0;
      }
      return;
    }
    if (this.useDynamicSize) return;
    const stride = this.itemMainSize + this.spacing;
    const totalLines = Math.ceil(this.totalCount / this.gridCount);
    this._contentSize = totalLines > 0 ? totalLines * stride - this.spacing : 0;
    if (this._isVertical()) this._contentTf.height = Math.max(this._contentSize, this._viewportSize);
    else this._contentTf.width = Math.max(this._contentSize, this._viewportSize);

    if (this._isVertical()) {
      this._boundsMin = 0;
      this._boundsMax = Math.max(0, this._contentSize - this._viewportSize);
    } else {
      this._boundsMin = -Math.max(0, this._contentSize - this._viewportSize);
      this._boundsMax = 0;
    }
  }

  /** 检查播放子项动画 */
  private checkPlayItemAnimation(idx, node) {
    if (this._needAnimateIndices.has(idx)) {
      if (this.playItemAppearAnimationFn) this.playItemAppearAnimationFn(node, idx);
      else this._playDefaultItemAppearAnimation(node, idx);
      this._needAnimateIndices.delete(idx);
    }
    if (this._enterAnimateIndices.has(idx)) {
      if (this.playItemEnterAnimationFn) this.playItemEnterAnimationFn(node, idx);
      else this._playDefaultItemEnterAnimationFn(node, idx);
      this._enterAnimateIndices.delete(idx);
    }
  }

  /**  默认的子项出现动画（可被外部替换），目前为空实现占位。*/
  private _playDefaultItemAppearAnimation(node: Node, idx: number) {
    console.log("_playDefaultItemAppearAnimation", node, idx)
  }

  /**  默认的子项进场动画。*/
  private _playDefaultItemEnterAnimationFn(node: Node, idx: number) {
    const line = Math.floor(idx / this.gridCount);
    const column = idx % this.gridCount;
    if (!node.getComponent(UIOpacity)) {
      node.addComponent(UIOpacity).opacity = 0
    }

    let size = 80
    let time = 0.36;
    let props: IProps = { alpha: 1 }
    let delay = 0
    let duration = 0.03 //层次间隔时间
    let firstTime = 0.03 //第一个出现的时间
    if (this.enterAnimationType == EnterAnimationType.TOP) {
      props.y = node.y
      node.y = node.y - size
      delay = duration * line + firstTime;
    } else if (this.enterAnimationType == EnterAnimationType.BOTTOM) {
      props.y = node.y
      node.y = node.y + size
      delay = duration * line + firstTime;
    } else if (this.enterAnimationType == EnterAnimationType.Left) {
      props.x = node.x
      node.x = node.x + size
      delay = duration * Math.max(0, this.gridCount - 1 - column) + firstTime
    } else if (this.enterAnimationType == EnterAnimationType.RIGHT) {
      props.x = node.x
      node.x = node.x - size
      delay = duration * Math.max(0, this.gridCount - 1 - column) + firstTime
    }
    TweenMgr.inst.get(node, node).delay(delay).to(time, props).start()
  }



  //================================ 不等大小的实现 =======================================

  /** 初始化不等大小模式：支持外部提供高度回调或从预制体采样尺寸。*/
  private _initDynamicSizeMode() {
    if (this.getItemHeightFn) {
      console.log('[VirtualScrollView] 使用外部提供的 getItemHeightFn');
      this._itemSizes = [];
      for (let i = 0; i < this.totalCount; i++) {
        this._itemSizes.push(this.getItemHeightFn(i));
      }
      this._buildPrefixSum();
      if (this.itemPrefabs.length > 0) {
        console.log('[VirtualScrollView] 初始化节点池');
        this._nodePool = new InternalNodePool(this.itemPrefabs);
      } else {
        console.error('[VirtualScrollView] 需要至少一个 itemPrefab');
        return;
      }
      this._initDynamicSlots();
      return;
    }
    if (this.itemPrefabs.length === 0 || !this.getItemTypeIndexFn) {
      console.error(
        '[VirtualScrollView] 不等大小模式必须提供以下之一：\n1. getItemHeightFn 回调函数\n2. itemPrefabs 数组 + getItemTypeIndexFn 回调函数'
      );
      return;
    }
    console.log('[VirtualScrollView] 使用采样模式（从 itemPrefabs 采样尺寸）');
    this._nodePool = new InternalNodePool(this.itemPrefabs);
    this._prefabSizeCache.clear();
    for (let i = 0; i < this.itemPrefabs.length; i++) {
      const sampleNode = instantiate(this.itemPrefabs[i]);
      const uit = sampleNode.getComponent(UITransform);
      const size = this._isVertical() ? uit?.height || 100 : uit?.width || 100;
      this._prefabSizeCache.set(i, size);
      sampleNode.destroy();
      console.log(`[VirtualScrollView] 预制体[${i}] 采样尺寸: ${size}`);
    }
    this._itemSizes = [];
    for (let i = 0; i < this.totalCount; i++) {
      console.error("_itemSizes, i= ", i)
      const typeIndex = this.getItemTypeIndexFn(i);
      const size = this._prefabSizeCache.get(typeIndex);
      if (size !== undefined) {
        this._itemSizes.push(size);
      } else {
        console.warn(`[VirtualScrollView] 索引 ${i} 的类型索引 ${typeIndex} 无效，使用默认尺寸`);
        this._itemSizes.push(this._prefabSizeCache.get(0) || 100);
      }
    }
    this._buildPrefixSum();
    this._initDynamicSlots();
  }

  /** 根据 _itemSizes 构建前缀和数组（每个项的起始位置）并计算 content 大小与边界。 */
  private _buildPrefixSum() {
    const n = this._itemSizes.length;
    this._prefixPositions = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this._prefixPositions[i] = acc;
      acc += this._itemSizes[i] + this.spacing;
    }
    this._contentSize = acc - this.spacing;
    if (this._contentSize < 0) this._contentSize = 0;
    if (this._isVertical()) this._contentTf.height = Math.max(this._contentSize, this._viewportSize);
    else this._contentTf.width = Math.max(this._contentSize, this._viewportSize);

    // 修改：横向模式的边界
    if (this._isVertical()) {
      this._boundsMin = 0; // 顶部
      this._boundsMax = Math.max(0, this._contentSize - this._viewportSize); // 底部（正值）
    } else {
      this._boundsMin = -Math.max(0, this._contentSize - this._viewportSize); // 最大滚动距离（负值）
      this._boundsMax = 0; // 初始位置（顶部）
    }
  }

  /** 根据采样尺寸和视口计算并初始化不等高模式所需的插槽数量。 */
  private _initDynamicSlots() {
    const avgSize = this._contentSize / this.totalCount || 100;
    const visibleCount = Math.ceil(this._viewportSize / avgSize);
    let neededSlots = visibleCount + this.buffer * 2 + 4;
    const minSlots = Math.ceil(this._viewportSize / 80) + this.buffer * 2;
    neededSlots = Math.max(neededSlots, minSlots);
    const maxSlots = Math.ceil(this._viewportSize / 50) + this.buffer * 4;
    neededSlots = Math.min(neededSlots, maxSlots);
    this._slots = Math.min(neededSlots, Math.max(this.totalCount, minSlots));
    this._slotNodes = new Array(this._slots).fill(null);
    this._slotPrefabIndices = new Array(this._slots).fill(-1);
    this._slotFirstIndex = 0;
    this._layoutSlots(this._slotFirstIndex, true);
    console.log(`[VScrollView] 初始化槽位: ${this._slots} (总数据: ${this.totalCount}, 视口尺寸: ${this._viewportSize})`);
  }

  /**
   * 将主方向位置转换为第一个显示项的索引（用于二分查找前缀和）。
   * @param pos 主方向上的滚动位置（正向）
   */
  private _posToFirstIndex(pos: number): number {
    if (pos <= 0) return 0;
    let l = 0,
      r = this._prefixPositions.length - 1,
      ans = this._prefixPositions.length;
    while (l <= r) {
      const m = (l + r) >> 1;
      if (this._prefixPositions[m] > pos) {
        ans = m;
        r = m - 1;
      } else {
        l = m + 1;
      }
    }
    return Math.max(0, ans - 1);
  }

  /**  计算给定滚动位置下可见项的索引区间（包含缓冲区）。*/
  private _calcVisibleRange(scrollPos: number): { start: number; end: number } {
    const n = this._prefixPositions.length;
    if (n === 0) return { start: 0, end: 0 };
    const start = this._posToFirstIndex(scrollPos);
    const endPos = scrollPos + this._viewportSize;
    let end = start;
    while (end < n) {
      if (this._prefixPositions[end] >= endPos) break;
      end++;
    }
    return { start: Math.max(0, start - this.buffer), end: Math.min(n, end + this.buffer) };
  }

  /** 在不等大小模式下根据当前视口扩展插槽数量（如果需要）。*/
  private _expandSlotsIfNeeded() {
    let neededSlots = 0;
    let pos = 0;
    const endPos = this._viewportSize;
    for (let i = 0; i < this.totalCount; i++) {
      if (pos >= endPos) break;
      neededSlots++;
      pos += this._itemSizes[i] + this.spacing;
    }
    neededSlots += this.buffer * 2 + 4;
    const minSlots = Math.ceil(this._viewportSize / 80) + this.buffer * 2;
    neededSlots = Math.max(neededSlots, minSlots);
    const maxSlots = Math.ceil(this._viewportSize / 50) + this.buffer * 4;
    neededSlots = Math.min(neededSlots, maxSlots);
    if (neededSlots > this._slots) {
      const oldSlots = this._slots;
      this._slots = neededSlots;
      for (let i = oldSlots; i < this._slots; i++) {
        this._slotNodes.push(null);
        this._slotPrefabIndices.push(-1);
      }
      console.log(`[VScrollView] 槽位扩展: ${oldSlots} -> ${this._slots} (总数据: ${this.totalCount})`);
    }
  }

  /**
   * 在不等大小模式下更新单个项的高度并重建后续前缀和。
   * @param index 要更新的项索引
   * @param newSize 新的高度（可选）
   */
  public updateItemHeight(index: number, newSize?: number) {
    if (!this.useDynamicSize) {
      console.warn('[VScrollView] 只有不等大小模式支持 updateItemHeight');
      return;
    }
    if (index < 0 || index >= this.totalCount) {
      console.warn(`[VScrollView] 索引 ${index} 超出范围`);
      return;
    }
    let size = newSize;
    if (size === undefined) {
      if (this.getItemHeightFn) {
        size = this.getItemHeightFn(index);
      } else {
        console.error('[VScrollView] 没有提供 newSize 参数，且未设置 getItemHeightFn');
        return;
      }
    }
    if (this._itemSizes[index] === size) return;
    this._itemSizes[index] = size;
    this._rebuildPrefixSumFrom(index);
    this._updateVisible(true);
  }

  /** 从指定索引开始重建前缀和与 content 大小（用于局部更新性能优化）。*/
  private _rebuildPrefixSumFrom(startIndex: number) {
    if (startIndex === 0) {
      this._buildPrefixSum();
      return;
    }
    let acc = this._prefixPositions[startIndex - 1] + this._itemSizes[startIndex - 1] + this.spacing;
    for (let i = startIndex; i < this._itemSizes.length; i++) {
      this._prefixPositions[i] = acc;
      acc += this._itemSizes[i] + this.spacing;
    }
    this._contentSize = acc - this.spacing;
    if (this._contentSize < 0) this._contentSize = 0;
    if (this._isVertical()) this._contentTf.height = Math.max(this._contentSize, this._viewportSize);
    else this._contentTf.width = Math.max(this._contentSize, this._viewportSize);

    if (this._isVertical()) {
      this._boundsMin = 0;
      this._boundsMax = Math.max(0, this._contentSize - this._viewportSize);
    } else {
      this._boundsMin = -Math.max(0, this._contentSize - this._viewportSize);
      this._boundsMax = 0;
    }
  }


  //================================ 对外接口  =======================================

  /** 刷新指定索引对应的槽位内容（如果该索引当前可见）。*/
  public refreshIndex(index: number) {
    if (!this.useVirtualList) {
      console.warn('[VirtualScrollView] 简单滚动模式不支持 refreshIndex');
      return;
    }
    const first = this._slotFirstIndex;
    const last = first + this._slots - 1;
    if (index < first || index > last) return;
    const slot = index - first;
    const node = this._slotNodes[slot];
    if (node && this.renderItemFn) this.renderItemFn(node, index);
  }

  /** 根据传入的数据刷新列表（支持传入数组或直接传入数量）。*/
  public refreshList(data: any[] | number) {
    if (!this.useVirtualList) {
      console.warn('[VirtualScrollView] 简单滚动模式不支持 refreshList');
      return;
    }
    if (typeof data === 'number') this.upTotalCount(data);
    else this.upTotalCount(data.length);
  }

  /** 批量更新多个项的高度并在必要时重建前缀和。*/
  public updateItemHeights(updates: Array<{ index: number; height: number }>) {
    if (!this.useDynamicSize) {
      console.warn('[VScrollView] 只有不等大小模式支持 updateItemHeights');
      return;
    }
    if (updates.length === 0) return;
    let minIndex = this.totalCount;
    let hasChange = false;
    for (const { index, height } of updates) {
      if (index < 0 || index >= this.totalCount) continue;
      if (this._itemSizes[index] !== height) {
        this._itemSizes[index] = height;
        minIndex = Math.min(minIndex, index);
        hasChange = true;
      }
    }
    if (!hasChange) return;
    this._rebuildPrefixSumFrom(minIndex);
    this._updateVisible(true);
  }

  /**  滚动到指定位置，可选择是否使用动画（缓动）。*/
  private _scrollToPosition(targetPos: number, animate = false) {
    targetPos = math.clamp(targetPos, this._boundsMin, this._boundsMax);
    if (this._scrollTween) {
      this._scrollTween.stop();
      this._scrollTween = null;
    }
    this._velocity = 0;
    this._isTouching = false;
    this._velSamples.length = 0;
    if (!animate) {
      this._setContentMainPos(this.pixelAlign ? Math.round(targetPos) : targetPos);
      this._updateVisible(true);
    } else {
      const currentPos = this._getContentMainPos();
      const distance = Math.abs(targetPos - currentPos);
      const duration = Math.max(0.2, distance / 3000);
      const targetVec = this._isVertical() ? new Vec3(0, targetPos, 0) : new Vec3(targetPos, 0, 0);
      this._scrollTween = tween(this.content!)
        .to(
          duration,
          { position: targetVec },
          {
            easing: 'smooth',
            onUpdate: () => {
              this._updateVisible(false);
            },
          }
        )
        .call(() => {
          this._updateVisible(true);
          this._scrollTween = null;
          this._velocity = 0;
        })
        .start();
    }
  }

  /** 滚动到顶部（视实际方向可能为最小或最大边界）。 */
  public scrollToTop(animate = false) {
    const target = this._isVertical() ? this._boundsMin : this._boundsMax;
    this._scrollToPosition(target, animate);
  }

  /** 滚动到底部（视实际方向可能为最小或最大边界）。*/
  public scrollToBottom(animate = false) {
    const target = this._isVertical() ? this._boundsMax : this._boundsMin;
    this._scrollToPosition(target, animate);
  }

  /** 滚动到指定索引位置，支持动画。 */
  public scrollToIndex(index: number, animate = false) {
    index = math.clamp(index | 0, 0, Math.max(0, this.totalCount - 1));
    let targetPos = 0;
    if (this.useDynamicSize) {
      targetPos = this._prefixPositions[index] || 0;
    } else {
      const line = Math.floor(index / this.gridCount);
      targetPos = line * (this.itemMainSize + this.spacing);
    }
    // 横向模式：滚动方向相反，取负值
    if (!this._isVertical()) {
      targetPos = -targetPos;
    }
    this._scrollToPosition(targetPos, animate);
  }

  /** 开关子项的渲染层级初始化标志并立即应用。 */
  public onOffSortLayer(onoff: boolean) {
    this._initSortLayerFlag = onoff;
    for (const element of this._slotNodes) {
      const sitem = element?.getComponent(VScrollViewItem);
      if (sitem) {
        if (this._initSortLayerFlag) sitem.onSortLayer();
        else sitem.offSortLayer();
      }
    }
  }


  //================================ 事件与滑动 =======================================


  @property({ displayName: '惯性阻尼系数', tooltip: '指数衰减系数，越大减速越快', range: [0, 10, 0.5], })
  public inertiaDampK: number = 1;

  @property({ displayName: '弹簧刚度', tooltip: '越界弹簧刚度 K（建议 120–240）' })
  public springK: number = 150.0;

  @property({ displayName: '弹簧阻尼', tooltip: '越界阻尼 C（建议 22–32）' })
  public springC: number = 26.0;

  @property({ displayName: '速度阈值', tooltip: '速度阈值（像素/秒），低于即停止' })
  public velocitySnap: number = 5;

  @property({ displayName: '速度窗口', tooltip: '速度估计窗口（秒）' })
  public velocityWindow: number = 0.08;

  @property({ displayName: '最大惯性速度', tooltip: '最大惯性速度（像素/秒）' })
  public maxVelocity: number = 6000;

  @property({ displayName: 'iOS减速曲线', tooltip: '是否使用 iOS 风格的减速曲线' })
  public useIOSDecelerationCurve: boolean = true;


  private _velSamples: { t: number; delta: number }[] = []; // 速度采样数组，用于估算抬起时的惯性速度
  private _velocity = 0; // 当前惯性速度（像素/秒）
  private _isTouching = false; // 当前是否正在触摸/拖拽
  private _scrollTween: any = null; // 滚动缓动对象引用（用于缓动滚动）


  /** 每帧更新：处理惯性、弹簧回弹并在位置改变时更新可见项。*/
  update(dt: number) {
    if (!this.content || this._isTouching || this._scrollTween) return;
    let pos = this._getContentMainPos();
    let a = 0;

    // 修改：需要判断哪个是最小边界，哪个是最大边界
    const minBound = Math.min(this._boundsMin, this._boundsMax);
    const maxBound = Math.max(this._boundsMin, this._boundsMax);

    if (pos < minBound) {
      // 超出最小边界（纵向：下方；横向：左方）
      a = -this.springK * (pos - minBound) - this.springC * this._velocity;
    } else if (pos > maxBound) {
      // 超出最大边界（纵向：上方；横向：右方）
      a = -this.springK * (pos - maxBound) - this.springC * this._velocity;
    } else {
      if (this.useIOSDecelerationCurve) {
        const speed = Math.abs(this._velocity);
        if (speed > 2000) this._velocity *= Math.exp(-this.inertiaDampK * 0.7 * dt);
        else if (speed > 500) this._velocity *= Math.exp(-this.inertiaDampK * dt);
        else this._velocity *= Math.exp(-this.inertiaDampK * 1.3 * dt);
      } else {
        this._velocity *= Math.exp(-this.inertiaDampK * dt);
      }
    }
    this._velocity += a * dt;
    if (Math.abs(this._velocity) < this.velocitySnap && a === 0) this._velocity = 0;
    if (this._velocity !== 0) {
      pos += this._velocity * dt;
      if (this.pixelAlign) pos = Math.round(pos);
      this._setContentMainPos(pos);
      if (this.useVirtualList) this._updateVisible(false);
    }
  }

  /** 组件销毁时释放资源与解绑事件。*/
  onDestroy() {
    input.off(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this._onGlobalTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_START, this._onDown, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this._onMove, this);
    this.node.off(Node.EventType.TOUCH_END, this._onUp, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this._onUp, this);
    if (this._nodePool) {
      this._nodePool.clear();
      this._nodePool = null;
    }
  }

  /** 绑定本节点触摸事件处理（按下/移动/抬起/取消）。*/
  private _bindTouch() {
    this.node.on(Node.EventType.TOUCH_START, this._onDown, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this._onMove, this);
    this.node.on(Node.EventType.TOUCH_END, this._onUp, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this._onUp, this);
  }

  /** 绑定全局触摸结束/取消事件用于捕获在外部结束的触摸。*/
  private _bindGlobalTouch() {
    input.on(Input.EventType.TOUCH_END, this._onGlobalTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this._onGlobalTouchEnd, this);
  }

  /** 全局触摸结束回调：若当前正在触摸，则触发本地抬起逻辑。*/
  private _onGlobalTouchEnd(event: EventTouch) {
    if (this._isTouching) {
      console.log('[VScrollView] Global touch end detected');
      this._onUp(event);
    }
  }

  /** 触摸按下事件处理：设置触摸标志并停止当前滚动缓动。*/
  private _onDown(e: EventTouch) {
    this._isTouching = true;
    this._velocity = 0;
    this._velSamples.length = 0;
    if (this._scrollTween) {
      this._scrollTween.stop();
      this._scrollTween = null;
    }
  }

  /** 触摸移动事件处理：移动 content，并记录用于速度估算的样本。*/
  private _onMove(e: EventTouch) {
    if (!this._isTouching) return;
    const uiDelta = e.getUIDelta(this._tmpMoveVec2);
    const delta = this._isVertical() ? uiDelta.y : uiDelta.x;
    let pos = this._getContentMainPos() + delta;
    if (this.pixelAlign) pos = Math.round(pos);
    this._setContentMainPos(pos);
    const t = performance.now() / 1000;
    this._velSamples.push({ t, delta });
    const t0 = t - this.velocityWindow;
    while (this._velSamples.length && this._velSamples[0].t < t0) this._velSamples.shift();
    if (this.useVirtualList) this._updateVisible(false);
  }

  /** 触摸抬起事件处理：基于采样计算惯性速度。*/
  private _onUp(e?: EventTouch) {
    if (!this._isTouching) return;
    this._isTouching = false;
    if (this._velSamples.length >= 2) {
      let sum = 0;
      let dtSum = 0;
      const sampleCount = Math.min(this._velSamples.length, 5);
      const startIndex = this._velSamples.length - sampleCount;
      for (let i = startIndex + 1; i < this._velSamples.length; i++) {
        sum += this._velSamples[i].delta;
        dtSum += this._velSamples[i].t - this._velSamples[i - 1].t;
      }
      if (dtSum > 0.001) {
        this._velocity = sum / dtSum;
        this._velocity = math.clamp(this._velocity, -this.maxVelocity, this.maxVelocity);
      } else {
        this._velocity =
          this._velSamples.length > 0 ? math.clamp(this._velSamples[this._velSamples.length - 1].delta * 60, -this.maxVelocity, this.maxVelocity) : 0;
      }
    } else if (this._velSamples.length === 1) {
      this._velocity = math.clamp(this._velSamples[0].delta * 60, -this.maxVelocity, this.maxVelocity);
    } else {
      this._velocity = 0;
    }
    this._velSamples.length = 0;
  }
}
