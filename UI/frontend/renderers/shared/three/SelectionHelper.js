/**
 * SelectionHelper.js - 框选矩形的 DOM 覆盖层
 *
 * **整份逐字搬自 `client/src/components/three/SelectionHelper.js`**，只做了两处
 * 改动，都在下面点名。原路径留了 re-export 壳 —— 那边有 **37 个**旧场景组件
 * 在 import，壳保证它们一行不用改。
 *
 * ## 它在这一层而不是 `core/` 的原因
 *
 * 构造函数里就 `document.createElement`，还往 `renderer.domElement` 上挂
 * 三个 pointer 监听。有 DOM、有 three 的 `Vector2` —— 两条都踩在
 * `core/` 的红线上（见 `../../core/index.js` 头部）。
 *
 * ## 它是怎么工作的
 *
 * 它**只负责画那个选框 div**，不负责算选中了谁。选中判定在渲染器里：
 * `PointGridRenderer` 拿 `pointTopLeft` / `pointBottomRight` 两个屏幕坐标，
 * 交给 `./pointPick.js` 的 `checkRectangleIntersection` + `checkRectIndex`
 * 换算成矩阵下标。所以这个类真正的对外面是那两个 `Vector2` 字段，不是方法。
 *
 * `isShiftPressed` 由宿主渲染器在自己的键盘事件里写，这个类不监听键盘
 * （构造函数末尾那个空的 `keyup` 监听是残留，见下）。
 *
 * ## 搬包时改的两处
 *
 * 1. **摘掉 `onSelectStart` 里的 `console.log(11111)`。** 每次按下鼠标都打，
 *    是调试残留 —— 和 `core/frameMath.js` 里 `press` 那句 `console.log(colArr)`
 *    同一类东西，处理方式也照那边：一个要发出去的包不该往消费者控制台写字。
 *    行为零变化。
 * 2. **`onPointerDown` 里那支 `this.setStartPoint(event)` 不再调用一个不存在的
 *    方法。** `setStartPoint` 与 `elementMove` 在原文件里是**注释掉的**（原
 *    107-110 行），所以这条路一旦走到就是 `TypeError`。它走不到：唯一能把
 *    `isKey` 置真的代码在构造函数末尾那个 `keyup` 监听里，而那个监听体也整个
 *    被注释掉了，`isKey` 恒为 `false`。原样搬进包等于把一颗哑弹带进别人的项目，
 *    所以这里合并成「和 `isKey === false` 走同一条路」，并保留 `isKey` 字段本身
 *    以防有宿主在外面读它。
 *
 * 其余一切照抄：空的 `keyup` 监听、被注释掉的 `onSelectOver()` 调用、
 * `onSelectMove` 里那段多余的缩进，都留着。**它们是线索，不是脏东西** ——
 * 「拖动选框」这个功能当初做了一半，那些注释就是那半个功能的化石。
 *
 * ## 已知缺陷（照搬，不在这一轮修）
 *
 * - `dispose()` 摘了三个 pointer 监听，但**没摘构造函数里那个 `document` 上的
 *   `keyup`**，也没把 `element` 从 DOM 里拿掉（那是 `onSelectOver` 的活，而它
 *   在 `onPointerUp` 里被注释掉了）。反复挂载卸载会在 `document` 上累积空监听。
 *   监听体是空的，所以只泄漏内存不改行为。记进积压。
 * - 选框用 `clientX/clientY` 直接写 `style.left/top`，也就是**假定选框的父元素
 *   铺满视口且不滚动**。主应用里成立。消费者把渲染器放进一个滚动容器、或放在
 *   有 `transform` 的祖先里，选框就会偏。文档站的「入参」页要写这条。
 */

import { Vector2 } from 'three';

class SelectionHelper {



	constructor(renderer, controls, cssClassName) {

		this.element = document.createElement('div');
		this.element.classList.add(cssClassName);
		this.element.style.pointerEvents = 'none';

		this.renderer = renderer;
		this.controls = controls;
		this.startPoint = new Vector2();
		this.pointTopLeft = new Vector2();
		this.pointBottomRight = new Vector2();
		this.isShiftPressed = false;
		this.isDown = false;
		this.isKey = false;
		this.shiftFlag = 0
		this.elementDownFlag = false
		this.pointStart = new Vector2();

		this.onPointerDown = function (event) {

			// 原实现在这里按 `isKey` 分两支，另一支调 `this.setStartPoint(event)`
			// —— 而 `setStartPoint` 是被注释掉的，走到就是 TypeError。`isKey`
			// 恒为 false（能置真的那个 keyup 监听体也是空的），所以两支合并成
			// 一支，行为零变化。详见文件头第 2 条。
			this.isDown = true;
			this.onSelectStart(event);

		}.bind(this);

		this.onPointerMove = function (event) {
			if(this.isShiftPressed){
				if (this.isDown ) {
					this.onSelectMove(event);

				}
			}


		}.bind(this);

		this.onPointerUp = function () {

			this.isDown = false;
			// this.onSelectOver();

		}.bind(this);






		this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
		this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
		this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);




	}

	dispose() {

		this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
		this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
		this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);

	}

	onSelectStart(event) {
		if (this.isShiftPressed) {
			// this.element.style.display = 'none';

			this.renderer.domElement.parentElement.appendChild(this.element);

			this.element.style.left = event.clientX + 'px';
			this.element.style.top = event.clientY + 'px';
			this.element.style.width = '0px';
			this.element.style.height = '0px';

			this.startPoint.x = event.clientX;
			this.startPoint.y = event.clientY;
		}
	}

	// elementMove(event) {
	// 	console.log(parseInt(this.element.style.left) , this.element.style.left , event.clientX , this.pointStart)
	// 	this.element.style.left = parseInt(this.element.style.left) + (event.clientX - this.pointStart.x) +'px' ;
	// 	this.element.style.top = parseInt(this.element.style.top) + (event.clientY - this.pointStart.y)  + 'px';
	// }

	// setStartPoint(event) {
	// 	this.pointStart.x = event.clientX;
	// 	this.pointStart.y = event.clientY;
	// }

	onSelectMove(event) {

		// 按下shift键

			this.element.style.display = 'block';

			this.pointBottomRight.x = Math.max(this.startPoint.x, event.clientX);
			this.pointBottomRight.y = Math.max(this.startPoint.y, event.clientY);
			this.pointTopLeft.x = Math.min(this.startPoint.x, event.clientX);
			this.pointTopLeft.y = Math.min(this.startPoint.y, event.clientY);

			this.element.style.left = this.pointTopLeft.x + 'px';
			this.element.style.top = this.pointTopLeft.y + 'px';
			this.element.style.width = (this.pointBottomRight.x - this.pointTopLeft.x) + 'px';
			this.element.style.height = (this.pointBottomRight.y - this.pointTopLeft.y) + 'px';


	}

	onSelectOver() {
		if (this.element) {
			this.element.parentElement?.removeChild(this.element);
		}


	}

}

export { SelectionHelper };
