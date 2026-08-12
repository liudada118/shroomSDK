/**
 * pointPick.js - 把屏幕上的框选矩形换算成矩阵下标
 *
 * 三个函数**逐字搬自** `client/src/components/three/threeUtil1.js`（311 行）。
 * 那份文件里另有 3 个函数（`getPointCoordinateback` / `getPointCoordinateWowback`
 * / `getPointCoordinateWowhead`）没搬 —— 点阵渲染器不用它们，只有旧场景组件用，
 * 且三者与 `getPointCoordinate` 是复制粘贴关系，净差异只有 `point.position.x`
 * 那一行里的偏移常量（`+100` / `-5600` / `+2200`）。**把 4 份复制粘贴合成 1 个
 * 带偏移参数的函数是另一件事**，会同时动到 35 个 import 方，不混在搬包里做。
 *
 * ## 为什么在 `react/` 这一层
 *
 * `getPointCoordinate` 读 `window.innerWidth` / `window.innerHeight`，还建
 * `THREE.Points`。有 DOM、有 three，进不了 `core/`。
 * 另两个（`checkRectangleIntersection` / `checkRectIndex`）其实是纯的算术，
 * 但它们和 `getPointCoordinate` 是**一条流水线上的三步**，拆到两层去反而
 * 让人找不着。它们的纯度已经由 `../../core/` 那边的规矩证明不了什么了。
 *
 * ## 三步是怎么串起来的
 *
 * ```
 * getPointCoordinate({particles, camera, position})
 *   → [首点屏幕坐标, 末点屏幕坐标]        // 整个点阵在屏幕上占的矩形
 * checkRectangleIntersection(点阵矩形, 选框矩形)
 *   → 交集矩形 | null                      // null = 框选没碰到点阵
 * checkRectIndex(点阵矩形, 交集矩形, width, height)
 *   → [startX, endX, startY, endY]         // 换算成矩阵下标，四个数都取整
 * ```
 *
 * ## 照抄、别"顺手修正"的地方
 *
 * - **`getPointCoordinate` 只取首末两个顶点**（`[0, positions.count - 1]`），
 *   靠「点阵是规则矩形」这个前提反推整体包围盒。点阵被旋转到某些角度时首末点
 *   不再是包围盒的两个对角，框选就会偏 —— 这是原行为。
 * - **`widthHalf` / `heightHalf` 用的是 `window.innerWidth/Height` 而不是画布
 *   尺寸**，原文件自己的注释就写着「此处应使用画布长和宽」。主应用里画布铺满
 *   视口所以看不出来；**消费者把渲染器放进一个小容器里，框选就会整体错位**。
 *   这是三条已知包边界问题里最容易踩的一条，文档站的「入参」页要写。
 *   修它要改签名（得把容器尺寸传进来），会动到 35 个 import 方，记进积压。
 * - **`checkRectIndex` 返回的四个数没有做边界夹取**，交集矩形贴边时可能算出
 *   等于 `width` / `height` 的下标。调用方（`PointGridRenderer`）自己夹。
 */

import * as THREE from "three";

/**
 * 求点阵在屏幕上占据的矩形（用首末两个顶点代表两个对角）。
 *
 * 逐字搬自 `threeUtil1.js:3-69`。
 *
 * @param {object} args
 * @param {THREE.Points} args.particles 点阵对象。
 * @param {THREE.Camera} args.camera 当前相机。
 * @param {{x: number, y: number, z: number}} args.position 点阵所在组的世界偏移。
 * @param {[number, number, number]} [args.axis1] 旋转轴，缺省 `[1, 0, 0]`。
 * @param {number} [args.angle1] 旋转角，缺省取 `particles.rotation.x`。
 * @returns {THREE.Vector3[]} 两个屏幕坐标（`x`/`y` 已换算成像素，`z` 是投影深度）。
 */
export function getPointCoordinate({ particles, camera, position , axis1 , angle1 }) {
    const positions = particles.geometry.attributes.position;

    const screenCoordinates = [];
    const dataArr = [0, positions.count - 1]
    for (let i = 0; i < dataArr.length; i++) {
        const vertex = new THREE.Vector3();
        vertex.fromBufferAttribute(positions, dataArr[i]); // 获取顶点的世界坐标
        const geometry = new THREE.BufferGeometry();
        const vertices = new THREE.Vector3(vertex.x, vertex.y, vertex.z)



        // 旋转角度
        let center = new THREE.Vector3(vertex.x, vertex.y, 0);
        const newVertices = vertices.clone()
        // console.log(center)
        newVertices.sub(center);
        const axis = axis1 ? new THREE.Vector3(...axis1) : new THREE.Vector3(1, 0, 0); // 旋转轴，这里使用 Y 轴作为示例
        const angle = angle1 ? angle1 : particles.rotation.x; // 旋转角度，这里使用 90 度作为示例

        const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        newVertices.applyQuaternion(quaternion);
        newVertices.add(center);

        // console.log(newVertices)

        // console.log(newVertices, 'vertices')
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const material = new THREE.PointsMaterial({ color: 0xff0000 });
        const point = new THREE.Points(geometry, material);

        point.scale.x = particles.scale.x;
        point.scale.y = particles.scale.y;
        point.scale.z = particles.scale.z;

        if (i == 0) {
            point.position.x = particles.position.x + position.x + vertices.x * particles.scale.x
            point.position.y = particles.position.y + position.y + (newVertices.y - vertices.y) * particles.scale.y
            point.position.z = particles.position.z + position.z + vertices.z * particles.scale.z + (newVertices.z - vertices.z) * particles.scale.z

        } else {
            point.position.x = particles.position.x + position.x + vertices.x * particles.scale.x
            point.position.y = particles.position.y + position.y + (newVertices.y - vertices.y) * particles.scale.y
            point.position.z = particles.position.z + position.z + vertices.z * particles.scale.z + (newVertices.z - vertices.z) * particles.scale.z

        }

        const vector = new THREE.Vector3();
        var widthHalf = 0.5 * window.innerWidth;  //此处应使用画布长和宽
        var heightHalf = 0.5 * window.innerHeight;

        point.updateMatrixWorld(); // 函数updateMatrix()和updateMatrixWorld(force)将根据position，rotation或quaternion，scale参数更新matrix和matrixWorld。updateMatrixWorld还会更新所有后代元素的matrixWorld，如果force值为真则调用者本身的matrixWorldNeedsUpdate值为真。

        //getPositionFromMatrix()方法已经删除,使用setFromMatrixPosition()替换, setFromMatrixPosition方法将返回从矩阵中的元素得到的新的向量值的向量
        vector.setFromMatrixPosition(point.matrixWorld);

        //projectOnVector方法在将当前三维向量(x,y,z)投影一个向量到另一个向量,参数vector(x,y,z).
        vector.project(camera);

        vector.x = (vector.x * widthHalf) + widthHalf;
        vector.y = -(vector.y * heightHalf) + heightHalf;
        // console.log(vector.x, vector.y,)
        screenCoordinates.push(vector)
    }
    return screenCoordinates
}

/**
 * 求两个轴对齐矩形的交集。
 *
 * 逐字搬自 `threeUtil1.js:282-297`。**纯函数。**
 * 注意判定用的是严格不等号，所以「刚好贴边」算不相交。
 *
 * @param {[number, number, number, number]} rect1 `[x1, y1, x2, y2]`。
 * @param {[number, number, number, number]} rect2 同上。
 * @returns {[number, number, number, number] | null} 交集矩形；不相交返回 null。
 */
export function checkRectangleIntersection(rect1, rect2) {
    const [x1_1, y1_1, x2_1, y2_1] = rect1;
    const [x1_2, y1_2, x2_2, y2_2] = rect2;

    if (x1_1 < x2_2 && x2_1 > x1_2 && y1_1 < y2_2 && y2_1 > y1_2) {
        const intersection = [
            Math.max(x1_1, x1_2),
            Math.max(y1_1, y1_2),
            Math.min(x2_1, x2_2),
            Math.min(y2_1, y2_2)
        ];
        return intersection;
    } else {
        return null;
    }
}

/**
 * 把「交集矩形在点阵矩形中的相对位置」按比例换算成矩阵下标。
 *
 * 逐字搬自 `threeUtil1.js:299-312`。**纯函数。**
 * 四个结果都过 `Math.round`，但**没有夹到 `[0, width]` / `[0, height]`**，
 * 调用方自己夹（见文件头）。
 *
 * @param {[number, number, number, number]} rectmax 点阵在屏幕上的外框。
 * @param {[number, number, number, number]} rectmin 交集矩形。
 * @param {number} width 矩阵列数。
 * @param {number} height 矩阵行数。
 * @returns {number[]} `[startX, endX, startY, endY]`，四个整数。
 */
export function checkRectIndex(rectmax, rectmin, width, height) {

    const [x1_1, y1_1, x2_1, y2_1] = rectmax;
    const [x1_2, y1_2, x2_2, y2_2] = rectmin;
    const rectHeight = y2_1 - y1_1
    const rectWidth = x2_1 - x1_1
    const startPointX = (x1_2 - x1_1) / rectWidth * width
    const pointLengthX = (x2_2 - x1_1) / rectWidth * width
    const startPointY = (y1_2 - y1_1) / rectHeight * height
    const pointLengthY = (y2_2 - y1_1) / rectHeight * height
    // console.log(rectmin, 'rectmin')
    return [startPointX, pointLengthX, startPointY, pointLengthY].map((a) =>  Math.round(a))
    // console.log(startPointX,pointLengthX,startPointY,pointLengthY)
}
