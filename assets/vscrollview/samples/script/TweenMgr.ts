/** 
 * 基于引擎Tween封装的易用性缓动系统
 * @author: deng
 * @since: 2025-04-14 11:20:53
* @copyright: gzyuanjin
 * @modify: 
 */

import { __private, Component, Node, Tween, tween, TweenEasing, UIOpacity, UITransform, Vec3, Widget } from "cc";

export class TweenMgr {
  private tweenMap: Map<Object, NodeTween[]> = new Map();
  private static _inst: TweenMgr;
  public static get inst(): TweenMgr {
    if (!this._inst) { this._inst = new TweenMgr(); }
    return this._inst;
  }
  /** 获取一个NodeTween */
  public get(target: Node, thisObject: Object): NodeTween {
    let nodeTween = new NodeTween(target);
    let list = this.tweenMap.get(thisObject) || []
    list.push(nodeTween)
    this.tweenMap.set(thisObject, list)
    return nodeTween;
  }

  /** 停止所有指定节点的缓动 */
  public stopAllByNode(target: Node) {
    Tween.stopAllByTarget(target)
    this.tweenMap.forEach((list, key) => {
      let index = list.findIndex(item => item.node == target)
      if (index >= 0) {
        list.splice(index, 1)
      }
      if (list.length == 0) {
        this.tweenMap.delete(key)
      }
    })
  }

  /** 停止所有指定对象的缓动 */
  public stopAllByThisObject(thisObject: Object) {
    let list = this.tweenMap.get(thisObject) || []
    list.forEach(item => {
      item.stop()
    })
    this.tweenMap.delete(thisObject)
  }

  /** 停止所有缓动 */
  public stopAll() {
    Tween.stopAll()
    this.tweenMap.clear()
  }
}

class NodeTween {
  private tween: Tween;
  /** 要激活 Tween 的对象 */
  public readonly node: Node;
  /** 真正执行的目标 */
  private _target: { value: number } = { "value": 0 };
  /** 开始时对应的属性值。可选属性为IProps类型, */
  private _startValueInfo: Partial<Record<keyof IProps, number>> = {}

  public constructor(target: Node) {
    this.node = target;
    this.create();
  }

  /**动画创建 */
  private create() {
    if (!this.tween) {
      this._target = { "value": 0 }
      this.tween = tween(this._target)
    }
  }

  /** 0-1进度的实时回调 */
  public update(duration: number, opts: ITweenOption = {}): NodeTween {
    this.tween.to(duration, { value: 1 }, {
      easing: opts.easing,
      onUpdate: (targetValue) => {
        let value = targetValue.value - 0;
        opts.onUpdate && opts.onUpdate(value)
      },
      onComplete: () => {
        this._target.value = 0
        // this.node[`value`] = 0
      }

    })
    return this
  }

  /**
   * 添加一个对属性进行绝对值计算的
   * @param duration  缓动时间，单位为秒
   * @param props  
   * @param opts 
   * @returns 
   */
  public to(duration: number, props: IProps, opts: ITweenOption = {}): NodeTween {
    this.tween.to(duration, { value: 1 }, {
      easing: opts.easing,
      onStart: () => { this.initProps(props) },
      onUpdate: (targetValue) => {
        if (duration == 0) { targetValue.value = 1 }; //0秒的时候也会调用2帧。第一帧为0，第二帧为1
        let value = targetValue.value - 0;
        for (let key in props) {
          let startValue = this._startValueInfo[key]
          let updateValue = startValue + (props[key] - startValue) * value
          this.setPropsValue(key as keyof IProps, updateValue)
          opts.onUpdate && opts.onUpdate()
        }
      },
      onComplete: () => {
        this._target.value = 0
        // this.node[`value`] = 0
      }
    })
    return this
  }

  /**
   * 添加一个对属性进行相对值计算的
   * @param props 
   * @param duration 
   * @param ease 
   * @returns 
   */
  public by(duration: number, props: IProps, opts: ITweenOption = {}): NodeTween {
    this.tween.to(duration, { value: 1 }, {
      easing: opts.easing,
      onStart: () => {
        this.initProps(props)
      },
      onUpdate: (targetValue) => {
        let value = targetValue.value - 0;
        for (let key in props) {
          let startValue = this._startValueInfo[key]
          let updateValue = startValue + props[key] * value
          this.setPropsValue(key as keyof IProps, updateValue)
          opts.onUpdate && opts.onUpdate()
        }
      },
      onComplete: () => {
        this._target.value = 0
        // this.node[`value`] = 0
      }
    })
    return this
  }

  /** 添加一个 直接设置目标属性 的瞬时动作 */
  public set(props: IProps) {
    this.to(0, props)
    return this
  }

  /** 添加延迟 */
  public delay(duration: number): NodeTween {
    this.tween.delay(duration)
    return this
  }

  /** 添加一个回调函数 */
  public call(callback: () => void): NodeTween {
    this.tween.call(callback)
    return this
  }

  /**  将之前所有的动作都永远循环(不支持单个动画循环) */
  public repeatForever() {
    this.tween.union()
    this.tween.repeatForever()
    return this
  }

  /**  将之前所有的动作指定循环次数(不支持单个动画循环) */
  public repeat(repeatTimes: number) {
    this.tween.union()
    this.tween.repeat(repeatTimes)
    return this
  }

  /** autoRemvoe */
  public autoRemove(callback?: () => void) {
    this.tween.call(() => {
      TweenMgr.inst.stopAllByNode(this.node)
      callback && callback()
    })
    return this
  }


  public start() {
    this.tween.start();
  }

  public stop() {
    this.tween.stop();
    this.tween = null;
  }

  //===================== 辅助方法 ========================
  private initProps(props: IProps) {
    this._startValueInfo = {}
    for (let key in props) {
      this._startValueInfo[key] = this.getPropsValue(key as keyof IProps)
    }
  }


  private getPropsValue(key: keyof IProps) {
    switch (key) {
      case "x":
        return this.node.position.x
      case "y":
        return this.node.position.y
      case "scaleX":
        return this.node.scale.x
      case "scaleY":
        return this.node.scale.y
      case "alpha":
        return Math.floor(this.getComponent(this.node, UIOpacity).opacity / 255 * 100) / 100
      case "angle":
        return this.node.angle
      case "witdh":
        return this.getComponent(this.node, UITransform).width || 0
      case "height":
        return this.getComponent(this.node, UITransform)?.height || 0
      case "top":
        return this.getComponent(this.node, Widget)?.top || 0
      case "bottom":
        return this.getComponent(this.node, Widget)?.bottom || 0
      case "left":
        return this.getComponent(this.node, Widget)?.left || 0
      case "right":
        return this.getComponent(this.node, Widget)?.right || 0
      case "horizontalCenter":
        return this.getComponent(this.node, Widget)?.horizontalCenter || 0
      case "verticalCenter":
        return this.getComponent(this.node, Widget)?.verticalCenter || 0
      default:
        return 0

    }
  }

  private setPropsValue(key: keyof IProps, updateValue: number) {
    switch (key) {
      case "x":
        this.node.position = new Vec3(updateValue, this.node.position.y)
        break;
      case "y":
        this.node.position = new Vec3(this.node.position.x, updateValue)
        break;
      case "scaleX":
        this.node.scale = new Vec3(updateValue, this.node.scale.y, this.node.scale.z)
        break;
      case "scaleY":
        this.node.scale = new Vec3(this.node.scale.x, updateValue, this.node.scale.z)
        break;
      case "alpha":
        this.node.getComponent(UIOpacity).opacity = updateValue * 255
        break;
      case "angle":
        this.node.angle = updateValue
        break;
      case "witdh":
        this.node.getComponent(UITransform).setContentSize(updateValue, this.node.getComponent(UITransform).height)
        break;
      case "height":
        this.node.getComponent(UITransform).setContentSize(this.node.getComponent(UITransform).width, updateValue)
        break;
      case "top":
        this.node.getComponent(Widget).top = updateValue
        break;
      case "bottom":
        this.node.getComponent(Widget).bottom = updateValue
        break;
      case "left":
        this.node.getComponent(Widget).left = updateValue
        break;
      case "right":
        this.node.getComponent(Widget).right = updateValue
        break;
      case "horizontalCenter":
        this.node.getComponent(Widget).horizontalCenter = updateValue
        break;
      case "verticalCenter":
        this.node.getComponent(Widget).verticalCenter = updateValue
        break;
    }
  }

  private getComponent<T extends Component>(node: Node, classConstructor: __private.__types_globals__Constructor<T>): T {
    let comp = node.getComponent(classConstructor);
    if (!comp) {
      comp = node.addComponent(classConstructor);
    }
    return comp;
  }
}

//定义props支持的类型。 对象的属性集合
export interface IProps {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  witdh?: number;
  height?: number;
  angle?: number; //旋转角度
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  horizontalCenter?: number;
  verticalCenter?: number;
}

interface ITweenOption<T extends object = any> {
  /** 缓动函数，可以使用已有的，也可以传入自定义的函数。 */
  easing?: TweenEasing | ((k: number) => number);

  /**  回调，当缓动动作更新时触发。 */
  onUpdate?: (target?: T, ratio?: number) => void;

}