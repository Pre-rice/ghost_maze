import { WALL_TYPES, GAME_STATES, EDITOR_TOOLS } from './constants.js';

/**
 * Renderer 模块 - 处理所有Canvas绘制相关的功能
 */

/**
 * 渲染静态背景层（地面、网格线）到离屏Canvas
 * @param {object} config - 渲染配置
 */
export function renderStaticLayer(config) {
    const { staticLayerCanvas, staticLayerCtx, canvasWidth, canvasHeight, 
            width, height, cellSize, activeCells, colors, isEditor } = config;
    
    staticLayerCanvas.width = canvasWidth;
    staticLayerCanvas.height = canvasHeight;
    const ctx = staticLayerCtx;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (activeCells[y] && activeCells[y][x]) {
                ctx.fillStyle = colors.ground;
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                ctx.strokeStyle = colors.gridLine;
                ctx.lineWidth = 1;
                ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
            } else if (isEditor) {
                ctx.fillStyle = "rgba(0,0,0,0)";
                ctx.strokeStyle = colors.voidGrid;
                ctx.lineWidth = 0.5;
                ctx.setLineDash([2, 2]);
                ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
                ctx.setLineDash([]);
            }
        }
    }
}

/**
 * 绘制墙角
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} config - 渲染配置
 */
export function drawCorners(ctx, config) {
    const { width, height, cellSize, activeCells, hWalls, vWalls, 
            seenCells, debugVision, colors, isEditor } = config;
    
    const w = Math.max(2, cellSize / 10);
    ctx.fillStyle = colors.wall;
    
    const isActive = (cx, cy) => (cx >= 0 && cx < width && cy >= 0 && cy < height) ? activeCells[cy][cx] : false;
    
    const hasSolidWall = (type, wx, wy) => {
        if (type === 'h') {
            if (wx < 0 || wx >= width) return false;
            if (hWalls[wy] && hWalls[wy][wx] && hWalls[wy][wx].type === WALL_TYPES.SOLID) return true;
            return isActive(wx, wy - 1) !== isActive(wx, wy);
        } else {
            if (wy < 0 || wy >= height) return false;
            if (vWalls[wy] && vWalls[wy][wx] && vWalls[wy][wx].type === WALL_TYPES.SOLID) return true;
            return isActive(wx - 1, wy) !== isActive(wx, wy);
        }
    };
    
    for (let y = 0; y <= height; y++) {
        for (let x = 0; x <= width; x++) {
            const hasHLeft = hasSolidWall('h', x - 1, y);
            const hasHRight = hasSolidWall('h', x, y);
            const hasVUp = hasSolidWall('v', x, y - 1);
            const hasVDown = hasSolidWall('v', x, y);
            const connectedCount = (hasHLeft ? 1 : 0) + (hasHRight ? 1 : 0) + (hasVUp ? 1 : 0) + (hasVDown ? 1 : 0);
            
            if (connectedCount < 2) continue;
            
            if (!isEditor && !debugVision) {
                const isPureInternal = (x > 0 && x < width && y > 0 && y < height &&
                    isActive(x - 1, y - 1) && isActive(x, y - 1) && isActive(x - 1, y) && isActive(x, y));
                if (isPureInternal && !(seenCells[y - 1][x - 1] || seenCells[y - 1][x] || seenCells[y][x - 1] || seenCells[y][x])) continue;
            }
            
            ctx.fillRect(x * cellSize - w / 2, y * cellSize - w / 2, w, w);
        }
    }
}

/**
 * 绘制墙或门
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {number} x1 - 起点x
 * @param {number} y1 - 起点y
 * @param {number} x2 - 终点x
 * @param {number} y2 - 终点y
 * @param {object} wallObject - 墙对象
 * @param {number} cellSize - 单元格大小
 * @param {object} colors - 颜色配置
 * @param {string} gameState - 游戏状态
 * @param {boolean} isHighlight - 是否高亮
 */
export function drawWallOrDoor(ctx, x1, y1, x2, y2, wallObject, cellSize, colors, gameState, isHighlight = false) {
    const type = wallObject.type;
    
    ctx.strokeStyle = isHighlight ? colors.hoverHighlight : colors.wall;
    ctx.lineWidth = isHighlight ? Math.max(3, cellSize / 8) : 
        ([WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(type) ? Math.max(3, cellSize / 12) : Math.max(2, cellSize / 10));
    
    if (type === WALL_TYPES.SOLID) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    } else if (type === WALL_TYPES.GLASS) {
        const isHorizontal = y1 === y2;
        const lineLength = cellSize * 0.2;
        const offset = lineLength / 2;
        const points = [
            { x: x1 * 5 / 6 + x2 * 1 / 6, y: y1 * 5 / 6 + y2 * 1 / 6 },
            { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
            { x: x1 * 1 / 6 + x2 * 5 / 6, y: y1 * 1 / 6 + y2 * 5 / 6 }
        ];
        for (const p of points) {
            if (isHorizontal) {
                ctx.moveTo(p.x - offset, p.y + offset);
                ctx.lineTo(p.x + offset, p.y - offset);
            } else {
                ctx.moveTo(p.x - offset, p.y + offset);
                ctx.lineTo(p.x + offset, p.y - offset);
            }
        }
    } else if (type === WALL_TYPES.LOCKED || type === WALL_TYPES.ONE_WAY || type === WALL_TYPES.LETTER_DOOR) {
        let isLetterDoorOpen = (type === WALL_TYPES.LETTER_DOOR) && 
            (gameState === GAME_STATES.EDITOR ? wallObject.initialState === 'open' : wallObject.currentState === 'open');
        if (isLetterDoorOpen) return;
        
        const isHorizontal = y1 === y2;
        const lockWidth = cellSize * 0.2;
        if (isHorizontal) {
            ctx.rect(x1, y1 - lockWidth / 2, cellSize, lockWidth);
        } else {
            ctx.rect(x1 - lockWidth / 2, y1, lockWidth, cellSize);
        }
    } else if (type === WALL_TYPES.DOOR) {
        const isHorizontal = y1 === y2;
        const length = isHorizontal ? x2 - x1 : y2 - y1;
        const gap = length / 3;
        if (isHorizontal) {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + gap, y1);
            ctx.moveTo(x2 - gap, y2);
            ctx.lineTo(x2, y2);
        } else {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1, y1 + gap);
            ctx.moveTo(x2, y2 - gap);
            ctx.lineTo(x2, y2);
        }
    }
}

/**
 * 绘制箭头（用于单向门）
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {number} x1 - 起点x
 * @param {number} y1 - 起点y
 * @param {number} x2 - 终点x
 * @param {number} y2 - 终点y
 * @param {object} direction - 方向
 * @param {string} color - 颜色
 * @param {boolean} withStroke - 是否描边
 * @param {number} cellSize - 单元格大小
 */
export function drawArrow(ctx, x1, y1, x2, y2, direction, color, withStroke, cellSize) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const fontSize = cellSize * 0.6;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    
    if (direction.dx === 1) ctx.rotate(0);
    else if (direction.dx === -1) ctx.rotate(Math.PI);
    else if (direction.dy === 1) ctx.rotate(Math.PI / 2);
    else if (direction.dy === -1) ctx.rotate(-Math.PI / 2);
    
    ctx.scale(0.8, 1.0);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (withStroke) {
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.strokeText('>', 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText('>', 0, 0);
    
    ctx.restore();
}

/**
 * 绘制墙体覆盖层（数字、字母等）
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} config - 配置对象
 */
export function drawWallOverlays(ctx, config) {
    const { hWalls, vWalls, width, height, cellSize, seenCells, 
            debugVision, colors, inGame, activeCells, drawArrowFn } = config;
    
    const drawTextOnWall = (x1, y1, x2, y2, text, color) => {
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        const fontSize = cellSize * 0.4;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.strokeText(text.toString(), centerX, centerY);
        ctx.fillStyle = color;
        ctx.fillText(text.toString(), centerX, centerY);
    };
    
    // 横墙
    for (let y = 1; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const wall = hWalls[y][x];
            if (!wall || wall.type === WALL_TYPES.EMPTY) continue;
            if (activeCells && !(activeCells[y][x] && activeCells[y - 1][x])) continue;
            
            const isVisible = !inGame || debugVision || 
                (seenCells[y - 1] && seenCells[y - 1][x]) || (seenCells[y] && seenCells[y][x]);
            if (!isVisible) continue;
            
            if (wall.type === WALL_TYPES.LOCKED) {
                drawTextOnWall(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.keys, colors.key);
            } else if (wall.type === WALL_TYPES.LETTER_DOOR) {
                drawTextOnWall(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.letter, colors.key);
            } else if (wall.type === WALL_TYPES.ONE_WAY && wall.direction) {
                if (drawArrowFn) {
                    drawArrowFn(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.direction, colors.key, true);
                } else {
                    drawArrow(ctx, x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.direction, colors.key, true, cellSize);
                }
            }
        }
    }
    
    // 竖墙
    for (let y = 0; y < height; y++) {
        for (let x = 1; x < width; x++) {
            const wall = vWalls[y][x];
            if (!wall || wall.type === WALL_TYPES.EMPTY) continue;
            if (activeCells && !(activeCells[y][x] && activeCells[y][x - 1])) continue;
            
            const isVisible = !inGame || debugVision || 
                (seenCells[y] && seenCells[y][x - 1]) || (seenCells[y] && seenCells[y][x]);
            if (!isVisible) continue;
            
            if (wall.type === WALL_TYPES.LOCKED) {
                drawTextOnWall(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.keys, colors.key);
            } else if (wall.type === WALL_TYPES.LETTER_DOOR) {
                drawTextOnWall(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.letter, colors.key);
            } else if (wall.type === WALL_TYPES.ONE_WAY && wall.direction) {
                if (drawArrowFn) {
                    drawArrowFn(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.direction, colors.key, true);
                } else {
                    drawArrow(ctx, x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.direction, colors.key, true, cellSize);
                }
            }
        }
    }
}

/**
 * 绘制圆形（玩家、鬼、终点等）
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {number} x - 网格x坐标
 * @param {number} y - 网格y坐标
 * @param {number} cellSize - 单元格大小
 * @param {string} color - 颜色
 * @param {number} alpha - 透明度
 */
export function drawCircle(ctx, x, y, cellSize, color, alpha = 1.0) {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2, cellSize * 0.35, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1.0;
}

/**
 * 绘制物品（钥匙等）
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} item - 物品对象
 * @param {number} cellSize - 单元格大小
 * @param {object} colors - 颜色配置
 */
export function drawItem(ctx, item, cellSize, colors) {
    if (item.type === 'key') {
        const centerX = item.x * cellSize + cellSize / 2;
        const centerY = item.y * cellSize + cellSize / 2;
        const size = cellSize * 0.3;
        ctx.fillStyle = colors.key;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - size);
        ctx.lineTo(centerX + size, centerY);
        ctx.lineTo(centerX, centerY + size);
        ctx.lineTo(centerX - size, centerY);
        ctx.closePath();
        ctx.fill();
    }
}

/**
 * 绘制楼梯
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} stair - 楼梯对象
 * @param {number} cellSize - 单元格大小
 * @param {object} colors - 颜色配置
 * @param {boolean} isHighlight - 是否高亮
 * @param {number} alpha - 透明度
 */
export function drawStair(ctx, stair, cellSize, colors, isHighlight = false, alpha = 1.0) {
    const x = stair.x * cellSize;
    const y = stair.y * cellSize;
    const size = cellSize * 0.7;
    const offset = (cellSize - size) / 2;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = isHighlight ? colors.hoverHighlight : colors.wall;
    ctx.lineWidth = isHighlight ? 3 : 2;
    ctx.lineJoin = 'miter'; // 确保直角不出现凹陷
    ctx.lineCap = 'square'; // 确保线条端点平整
    
    // 绘制楼梯图标：三个方框锯齿加上两条完整边的密闭楼梯状图形
    // 向上楼梯：左低右高，向下楼梯：左高右低
    const left = x + offset;
    const top = y + offset;
    const stepWidth = size / 3;
    const stepHeight = size / 3;
    
    ctx.beginPath();
    
    if (stair.direction === 'up') {
        // 向上楼梯：左低右高
        // 从左下角开始顺时针绘制
        ctx.moveTo(left, top + size);                    // 左下角
        ctx.lineTo(left, top + size - stepHeight);       // 左边第一台阶
        ctx.lineTo(left + stepWidth, top + size - stepHeight);  // 第一台阶水平线
        ctx.lineTo(left + stepWidth, top + size - 2 * stepHeight);  // 第二台阶垂直线
        ctx.lineTo(left + 2 * stepWidth, top + size - 2 * stepHeight);  // 第二台阶水平线
        ctx.lineTo(left + 2 * stepWidth, top);           // 第三台阶垂直线到顶部
        ctx.lineTo(left + size, top);                    // 顶边
        ctx.lineTo(left + size, top + size);             // 右边
        ctx.closePath();                                  // 回到左下角
    } else {
        // 向下楼梯：左高右低
        // 从左下角开始顺时针绘制
        ctx.moveTo(left, top + size);                    // 左下角
        ctx.lineTo(left, top);                           // 左边到顶部
        ctx.lineTo(left + stepWidth, top);               // 顶边第一段
        ctx.lineTo(left + stepWidth, top + stepHeight);  // 第一台阶向下
        ctx.lineTo(left + 2 * stepWidth, top + stepHeight);  // 第二台阶水平线
        ctx.lineTo(left + 2 * stepWidth, top + 2 * stepHeight);  // 第二台阶向下
        ctx.lineTo(left + size, top + 2 * stepHeight);   // 第三台阶水平线
        ctx.lineTo(left + size, top + size);             // 右边到底部
        ctx.closePath();                                  // 回到左下角
    }
    
    // 填充半透明背景
    ctx.fillStyle = stair.direction === 'up' ? 'rgba(0, 200, 100, 0.3)' : 'rgba(200, 100, 0, 0.3)';
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
}

/**
 * 绘制按钮
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} button - 按钮对象
 * @param {number} cellSize - 单元格大小
 * @param {object} colors - 颜色配置
 * @param {boolean} isHighlight - 是否高亮
 */
export function drawButton(ctx, button, cellSize, colors, isHighlight = false) {
    const centerX = button.x * cellSize + cellSize / 2;
    const centerY = button.y * cellSize + cellSize / 2;
    const buttonLength = cellSize * 0.5;
    const buttonWidth = cellSize * 0.2;
    
    let p1, p2, p3, p4;
    let letterCenterX, letterCenterY;
    
    if (button.direction.dy === -1) { // 上
        p1 = { x: centerX - buttonLength / 2, y: button.y * cellSize };
        p2 = { x: centerX + buttonLength / 2, y: button.y * cellSize };
        p3 = { x: centerX + buttonLength / 2, y: button.y * cellSize + buttonWidth };
        p4 = { x: centerX - buttonLength / 2, y: button.y * cellSize + buttonWidth };
        letterCenterX = centerX;
        letterCenterY = p1.y + buttonWidth / 2;
    } else if (button.direction.dy === 1) { // 下
        p1 = { x: centerX - buttonLength / 2, y: (button.y + 1) * cellSize - buttonWidth };
        p2 = { x: centerX + buttonLength / 2, y: (button.y + 1) * cellSize - buttonWidth };
        p3 = { x: centerX + buttonLength / 2, y: (button.y + 1) * cellSize };
        p4 = { x: centerX - buttonLength / 2, y: (button.y + 1) * cellSize };
        letterCenterX = centerX;
        letterCenterY = p1.y + buttonWidth / 2;
    } else if (button.direction.dx === -1) { // 左
        p1 = { x: button.x * cellSize, y: centerY - buttonLength / 2 };
        p2 = { x: button.x * cellSize + buttonWidth, y: centerY - buttonLength / 2 };
        p3 = { x: button.x * cellSize + buttonWidth, y: centerY + buttonLength / 2 };
        p4 = { x: button.x * cellSize, y: centerY + buttonLength / 2 };
        letterCenterX = p1.x + buttonWidth / 2;
        letterCenterY = centerY;
    } else { // 右
        p1 = { x: (button.x + 1) * cellSize - buttonWidth, y: centerY - buttonLength / 2 };
        p2 = { x: (button.x + 1) * cellSize, y: centerY - buttonLength / 2 };
        p3 = { x: (button.x + 1) * cellSize, y: centerY + buttonLength / 2 };
        p4 = { x: (button.x + 1) * cellSize - buttonWidth, y: centerY + buttonLength / 2 };
        letterCenterX = p1.x + buttonWidth / 2;
        letterCenterY = centerY;
    }
    
    ctx.strokeStyle = isHighlight ? colors.hoverHighlight : colors.wall;
    ctx.lineWidth = isHighlight ? Math.max(3, cellSize / 8) : Math.max(2, cellSize / 10);
    ctx.beginPath();
    // 只绘制三边（跳过与墙重合的一边）
    if (button.direction.dy === -1) { // 上：跳过p1->p2（顶边）
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p2.x, p2.y);
    } else if (button.direction.dy === 1) { // 下：跳过p3->p4（底边）
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p4.x, p4.y);
    } else if (button.direction.dx === -1) { // 左：跳过p1->p4（左边）
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
    } else { // 右：跳过p2->p3（右边）
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.lineTo(p3.x, p3.y);
    }
    ctx.stroke();
    
    if (!isHighlight && button.letter) {
        // 与字母门使用相同的字体大小：cellSize * 0.4
        const fontSize = cellSize * 0.4;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.strokeText(button.letter, letterCenterX, letterCenterY);
        ctx.fillStyle = colors.key;
        ctx.fillText(button.letter, letterCenterX, letterCenterY);
    }
}

/**
 * 显示初始欢迎信息
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} config - 配置对象
 */
export function showInitialMessage(ctx, config) {
    const { canvasWidth, canvasHeight, padding, colors } = config;
    
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = colors.border || '#d9d9d9';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(padding, padding, canvasWidth - 2 * padding, canvasHeight - 2 * padding);
    ctx.setLineDash([]);
    ctx.fillStyle = colors.text;
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点击 "随机生成新地图" 或加载分享码开始游戏', canvasWidth / 2, canvasHeight / 2);
}

/**
 * 检查边界是否应该绘制
 * @param {number} bx - 边界X坐标
 * @param {number} by - 边界Y坐标
 * @param {boolean} isH - 是否为水平边界
 * @param {Array} activeCells - 活动单元格数组
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function shouldDrawBoundary(bx, by, isH, activeCells, width, height) {
    if (isH) {
        const up = (by > 0 && by <= height && activeCells[by-1]) ? activeCells[by-1][bx] : false;
        const down = (by >= 0 && by < height && activeCells[by]) ? activeCells[by][bx] : false;
        return up !== down;
    } else {
        const left = (bx > 0 && bx <= width && activeCells[by]) ? activeCells[by][bx-1] : false;
        const right = (bx >= 0 && bx < width && activeCells[by]) ? activeCells[by][bx] : false;
        return left !== right;
    }
}
