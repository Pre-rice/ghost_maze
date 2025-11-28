import { WALL_TYPES, GAME_STATES, EDITOR_TOOLS } from './constants.js';

/**
 * InputHandler 模块 - 处理所有输入事件（键盘、鼠标、触摸）
 */

/**
 * 获取鼠标在Canvas上的位置
 * @param {Event} e - 事件对象
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {object} drawOffset - 绘制偏移
 * @returns {object} {x, y} 坐标
 */
export function getMousePos(e, canvas, drawOffset = { x: 0, y: 0 }) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX || e.pageX) - rect.left - drawOffset.x,
        y: (e.clientY || e.pageY) - rect.top - drawOffset.y
    };
}

/**
 * 检查位置是否在起始房间内
 * @param {number} cellX - 单元格X坐标
 * @param {number} cellY - 单元格Y坐标
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function isPosInStartRoom(cellX, cellY, height) {
    const roomY = height - 3;
    return cellX >= 0 && cellX < 3 && cellY >= roomY && cellY < roomY + 3;
}

/**
 * 检查墙壁是否可编辑
 * @param {object} wall - 墙对象
 * @param {string} editorMode - 编辑模式
 * @param {number} height - 地图高度
 * @returns {boolean}
 */
export function isWallEditable(wall, editorMode, height) {
    if (!wall) return false;
    const { x, y, type } = wall;
    const roomY = height - 3;
    
    if (editorMode === 'free') return true;
    
    // 常规模式：不允许编辑边界墙和起始房间的墙
    if (type === 'h') {
        if (y === 0 || y === height) return false;
        if (x >= 0 && x < 3 && y === roomY) return false;
        if (x >= 0 && x < 3 && y >= roomY && y < roomY + 3) return false;
    } else {
        if (x === 0) return false;
        if (y >= roomY && y < roomY + 3 && x === 3) return false;
        if (x >= 0 && x < 3 && y >= roomY && y < roomY + 3) return false;
    }
    
    return true;
}

/**
 * 获取鼠标位置处的墙
 * @param {number} mouseX - 鼠标X坐标
 * @param {number} mouseY - 鼠标Y坐标
 * @param {object} config - 配置对象
 * @returns {object|null} 墙对象或null
 */
export function getWallAtPos(mouseX, mouseY, config) {
    const { width, height, cellSize, currentTool, activeCells } = config;
    const threshold = cellSize * 0.3;
    
    const cellX = Math.floor(mouseX / cellSize);
    const cellY = Math.floor(mouseY / cellSize);
    const cellOffsetX = mouseX - cellX * cellSize;
    const cellOffsetY = mouseY - cellY * cellSize;
    
    if (currentTool === EDITOR_TOOLS.GRID) {
        if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
            return { x: cellX, y: cellY, type: 'cell' };
        }
        return null;
    }
    
    let bestWall = null;
    let bestDist = threshold;
    
    // 检查当前单元格的上边界
    if (cellY >= 0 && cellY <= height && cellX >= 0 && cellX < width) {
        if (cellOffsetY < threshold) {
            const dist = cellOffsetY;
            if (dist < bestDist) {
                bestDist = dist;
                bestWall = { x: cellX, y: cellY, type: 'h' };
            }
        }
    }
    
    // 检查当前单元格的左边界
    if (cellX >= 0 && cellX <= width && cellY >= 0 && cellY < height) {
        if (cellOffsetX < threshold) {
            const dist = cellOffsetX;
            if (dist < bestDist) {
                bestDist = dist;
                bestWall = { x: cellX, y: cellY, type: 'v' };
            }
        }
    }
    
    // 检查当前单元格的下边界
    if (cellY + 1 >= 0 && cellY + 1 <= height && cellX >= 0 && cellX < width) {
        if (cellSize - cellOffsetY < threshold) {
            const dist = cellSize - cellOffsetY;
            if (dist < bestDist) {
                bestDist = dist;
                bestWall = { x: cellX, y: cellY + 1, type: 'h' };
            }
        }
    }
    
    // 检查当前单元格的右边界
    if (cellX + 1 >= 0 && cellX + 1 <= width && cellY >= 0 && cellY < height) {
        if (cellSize - cellOffsetX < threshold) {
            const dist = cellSize - cellOffsetX;
            if (dist < bestDist) {
                bestWall = { x: cellX + 1, y: cellY, type: 'v' };
            }
        }
    }
    
    return bestWall;
}

/**
 * 获取鼠标位置处的按钮热点
 * @param {number} mouseX - 鼠标X坐标
 * @param {number} mouseY - 鼠标Y坐标
 * @param {object} config - 配置对象
 * @returns {object|null} 按钮热点对象或null
 */
export function getButtonHotspotAtPos(mouseX, mouseY, config) {
    const { width, height, cellSize, activeCells } = config;
    const hotspotSize = cellSize * 0.4;
    
    const cellX = Math.floor(mouseX / cellSize);
    const cellY = Math.floor(mouseY / cellSize);
    
    if (cellX < 0 || cellX >= width || cellY < 0 || cellY >= height) return null;
    if (!activeCells[cellY][cellX]) return null;
    
    const cellCenterX = cellX * cellSize + cellSize / 2;
    const cellCenterY = cellY * cellSize + cellSize / 2;
    const relX = mouseX - cellCenterX;
    const relY = mouseY - cellCenterY;
    
    // 检查四个方向的热点区域
    const checkHotspot = (dx, dy, direction) => {
        const hotspotCenterX = cellCenterX + dx * (cellSize / 2 - hotspotSize / 2);
        const hotspotCenterY = cellCenterY + dy * (cellSize / 2 - hotspotSize / 2);
        const distX = Math.abs(mouseX - hotspotCenterX);
        const distY = Math.abs(mouseY - hotspotCenterY);
        if (distX < hotspotSize / 2 && distY < hotspotSize / 2) {
            return { x: cellX, y: cellY, direction };
        }
        return null;
    };
    
    const hotspots = [
        checkHotspot(0, -1, { dx: 0, dy: -1 }),  // 上
        checkHotspot(0, 1, { dx: 0, dy: 1 }),    // 下
        checkHotspot(-1, 0, { dx: -1, dy: 0 }),  // 左
        checkHotspot(1, 0, { dx: 1, dy: 0 })     // 右
    ];
    
    return hotspots.find(h => h !== null) || null;
}

/**
 * 获取鼠标相对于墙的位置（用于确定单向门方向）
 * @param {number} mouseX - 鼠标X坐标
 * @param {number} mouseY - 鼠标Y坐标
 * @param {object} wall - 墙对象
 * @param {number} cellSize - 单元格大小
 * @returns {object} 方向对象 {dx, dy}
 */
export function getMouseSideOfWall(mouseX, mouseY, wall, cellSize) {
    if (wall.type === 'h') {
        const wallY = wall.y * cellSize;
        return mouseY < wallY ? { dx: 0, dy: -1 } : { dx: 0, dy: 1 };
    } else {
        const wallX = wall.x * cellSize;
        return mouseX < wallX ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 };
    }
}

/**
 * 创建键盘事件处理器
 * @param {object} game - 游戏实例
 * @returns {function} 事件处理函数
 */
export function createKeyboardHandler(game) {
    return (e) => {
        if (game.state !== GAME_STATES.PLAYING) return;
        
        // 如果当前在多层模式且不在玩家所在层，先切换到玩家层
        if (game.multiLayerMode && game.currentLayer !== game.playerLayer) {
            game.switchToLayer(game.playerLayer);
        }
        
        let dx = 0, dy = 0;
        switch (e.key) {
            case 'ArrowUp': case 'w': case 'W': dy = -1; break;
            case 'ArrowDown': case 's': case 'S': dy = 1; break;
            case 'ArrowLeft': case 'a': case 'A': dx = -1; break;
            case 'ArrowRight': case 'd': case 'D': dx = 1; break;
            case ' ': game.useStair(); return;
            default:
                // 检查是否为按钮按键（字母键）
                if (/^[a-zA-Z]$/.test(e.key)) {
                    game.pressButton(e.key.toUpperCase());
                }
                return;
        }
        
        if (dx !== 0 || dy !== 0) {
            clearInterval(game.autoMoveInterval);
            game.movePlayer(dx, dy);
        }
    };
}

/**
 * 绑定D-pad控制器事件
 * @param {object} game - 游戏实例
 */
export function bindDpadControls(game) {
    let dpadInterval = null;
    
    const handleDpadPress = (dx, dy) => {
        if (game.state !== GAME_STATES.PLAYING) return;
        
        if (game.multiLayerMode && game.currentLayer !== game.playerLayer) {
            game.switchToLayer(game.playerLayer);
        }
        
        clearInterval(game.autoMoveInterval);
        clearInterval(dpadInterval);
        game.movePlayer(dx, dy);
        dpadInterval = setInterval(() => game.movePlayer(dx, dy), 200);
    };
    
    const handleCenterPress = () => {
        if (game.state !== GAME_STATES.PLAYING) return;
        
        if (game.multiLayerMode && game.currentLayer !== game.playerLayer) {
            game.switchToLayer(game.playerLayer);
        }
        
        game.useStair();
    };
    
    const handleDpadRelease = () => {
        clearInterval(dpadInterval);
    };
    
    const addListeners = (element, dx, dy) => {
        if (!element) return;
        element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleDpadPress(dx, dy);
        }, { passive: false });
        element.addEventListener('mousedown', () => handleDpadPress(dx, dy));
    };
    
    addListeners(document.getElementById('dpad-up'), 0, -1);
    addListeners(document.getElementById('dpad-down'), 0, 1);
    addListeners(document.getElementById('dpad-left'), -1, 0);
    addListeners(document.getElementById('dpad-right'), 1, 0);
    
    const centerBtn = document.getElementById('dpad-center');
    if (centerBtn) {
        centerBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleCenterPress();
        }, { passive: false });
        centerBtn.addEventListener('mousedown', handleCenterPress);
    }
    
    document.addEventListener('touchend', handleDpadRelease);
    document.addEventListener('mouseup', handleDpadRelease);
    
    // 返回清理函数
    return () => {
        clearInterval(dpadInterval);
    };
}

/**
 * 检查单元格是否被编辑器中的实体占用
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {object} config - 配置对象
 * @returns {boolean}
 */
export function isCellOccupiedInEditor(x, y, config) {
    const { ghosts, items, buttons, endPos, customStartPos, stairs, currentLayer } = config;
    
    if (ghosts.some(g => g.x === x && g.y === y)) return true;
    if (items.some(i => i.x === x && i.y === y)) return true;
    if (buttons.some(b => b.x === x && b.y === y)) return true;
    if (endPos && endPos.x === x && endPos.y === y) return true;
    if (customStartPos && customStartPos.x === x && customStartPos.y === y) return true;
    if (stairs.some(s => s.x === x && s.y === y && s.layer === currentLayer)) return true;
    
    return false;
}

/**
 * 检查楼梯放置是否有效
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {string} direction - 方向 ('up' | 'down')
 * @param {object} config - 配置对象
 * @returns {boolean}
 */
export function isValidStairPlacement(x, y, direction, config) {
    const { activeCells, stairs, currentLayer, layerCount } = config;
    
    // 检查单元格是否有效
    if (!activeCells[y] || !activeCells[y][x]) return false;
    
    // 检查是否已有楼梯
    if (stairs.some(s => s.x === x && s.y === y && s.layer === currentLayer)) return false;
    
    // 检查楼层限制
    if (direction === 'up' && currentLayer >= layerCount - 1) return false;
    if (direction === 'down' && currentLayer <= 0) return false;
    
    return true;
}
