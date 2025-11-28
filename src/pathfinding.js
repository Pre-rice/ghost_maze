import { WALL_TYPES } from './constants.js';

/**
 * Pathfinding 模块 - 路径查找算法
 */

/**
 * 计算从起点到所有可达点的距离（BFS）
 * @param {object} startNode - 起点 {x, y}
 * @param {number} width - 地图宽度
 * @param {number} height - 地图高度
 * @param {Array} hWalls - 横墙数组
 * @param {Array} vWalls - 竖墙数组
 * @returns {Array} 二维距离数组
 */
export function calculateDistances(startNode, width, height, hWalls, vWalls) {
    const distances = Array(height).fill(null).map(() => Array(width).fill(Infinity));
    const queue = [{ x: startNode.x, y: startNode.y, dist: 0 }];
    distances[startNode.y][startNode.x] = 0;
    
    while (queue.length > 0) {
        const { x, y, dist } = queue.shift();
        const neighbors = [
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }
        ];
        
        for (const { dx, dy } of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                let wall;
                if (dx === 1) wall = vWalls[y][x + 1];
                if (dx === -1) wall = vWalls[y][x];
                if (dy === 1) wall = hWalls[y + 1][x];
                if (dy === -1) wall = hWalls[y][x];
                
                if (wall && [WALL_TYPES.SOLID, WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY].includes(wall.type)) {
                    continue;
                }
                
                if (distances[ny][nx] === Infinity) {
                    distances[ny][nx] = dist + 1;
                    queue.push({ x: nx, y: ny, dist: dist + 1 });
                }
            }
        }
    }
    
    return distances;
}

/**
 * 查找玩家从起点到终点的路径（考虑可见性和墙壁）
 * @param {object} start - 起点 {x, y}
 * @param {object} end - 终点 {x, y}
 * @param {object} config - 配置对象
 * @returns {Array|null} 路径数组或null
 */
export function findPlayerPath(start, end, config) {
    const { width, height, hWalls, vWalls, seenCells, debugVision, playerKeys } = config;
    
    const queue = [[{ x: start.x, y: start.y }]];
    const visited = new Set([`${start.x},${start.y}`]);
    
    while (queue.length > 0) {
        const path = queue.shift();
        const { x, y } = path[path.length - 1];
        
        if (x === end.x && y === end.y) {
            return path;
        }
        
        const neighbors = [
            { dx: 0, dy: -1 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }
        ];
        
        for (const { dx, dy } of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited.has(key)) {
                // 检查可见性
                if (!seenCells[ny][nx] && !debugVision) {
                    continue;
                }
                
                let wall;
                let isBlocked = false;
                
                if (dx === 1) wall = vWalls[y][x + 1];
                else if (dx === -1) wall = vWalls[y][x];
                else if (dy === 1) wall = hWalls[y + 1][x];
                else if (dy === -1) wall = hWalls[y][x];
                
                if (wall) {
                    if (wall.type === WALL_TYPES.SOLID || 
                        wall.type === WALL_TYPES.GLASS || 
                        (wall.type === WALL_TYPES.LOCKED && playerKeys < wall.keys)) {
                        isBlocked = true;
                    } else if (wall.type === WALL_TYPES.ONE_WAY && 
                               (dx !== wall.direction.dx || dy !== wall.direction.dy)) {
                        isBlocked = true;
                    }
                }
                
                if (isBlocked) {
                    continue;
                }
                
                visited.add(key);
                const newPath = [...path, { x: nx, y: ny }];
                queue.push(newPath);
            }
        }
    }
    
    return null;
}

/**
 * 获取按钮热点位置
 * @param {number} mouseX - 鼠标X坐标
 * @param {number} mouseY - 鼠标Y坐标
 * @param {object} config - 配置对象
 * @returns {object|null} 按钮热点信息或null
 */
export function getButtonHotspotAtPos(mouseX, mouseY, config) {
    const { cellSize, width, height, activeCells, hWalls, vWalls, editorMode } = config;
    const cs = cellSize;
    
    let cellX = Math.floor(mouseX / cs);
    let cellY = Math.floor(mouseY / cs);
    
    const isValidCell = (cx, cy) => cx >= 0 && cx < width && cy >= 0 && cy < height;
    
    if (!isValidCell(cellX, cellY)) {
        const localX = mouseX - cellX * cs;
        const localY = mouseY - cellY * cs;
        const tolerance = cs * 0.3;
        
        if (localX > cs - tolerance && isValidCell(cellX + 1, cellY)) cellX++;
        else if (localX < tolerance && isValidCell(cellX - 1, cellY)) cellX--;
        else if (localY > cs - tolerance && isValidCell(cellX, cellY + 1)) cellY++;
        else if (localY < tolerance && isValidCell(cellX, cellY - 1)) cellY--;
        else return null;
    }
    
    if (!isValidCell(cellX, cellY) || !activeCells[cellY][cellX]) {
        return null;
    }
    
    const localX = mouseX - cellX * cs;
    const localY = mouseY - cellY * cs;
    let direction = null;
    
    if (localY < localX && localY < -localX + cs) direction = { dx: 0, dy: -1 };
    else if (localY > localX && localY > -localX + cs) direction = { dx: 0, dy: 1 };
    else if (localY > localX && localY < -localX + cs) direction = { dx: -1, dy: 0 };
    else if (localY < localX && localY > -localX + cs) direction = { dx: 1, dy: 0 };
    
    if (!direction) return null;
    
    const isActive = (x, y) => (x >= 0 && x < width && y >= 0 && y < height) ? activeCells[y][x] : false;
    let isAttachable = false;
    
    if (direction.dy === -1) {
        if (hWalls[cellY][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX, cellY - 1))) {
            isAttachable = true;
        }
    } else if (direction.dy === 1) {
        if (hWalls[cellY + 1][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX, cellY + 1))) {
            isAttachable = true;
        }
    } else if (direction.dx === -1) {
        if (vWalls[cellY][cellX].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX - 1, cellY))) {
            isAttachable = true;
        }
    } else if (direction.dx === 1) {
        if (vWalls[cellY][cellX + 1].type === WALL_TYPES.SOLID || (isActive(cellX, cellY) && !isActive(cellX + 1, cellY))) {
            isAttachable = true;
        }
    }
    
    if (isAttachable) {
        const roomYStart = height - 3;
        const isTopBoundary = direction.dy === -1 && cellY === roomYStart && cellX >= 0 && cellX < 3;
        const isRightBoundary = direction.dx === 1 && cellX === 2 && cellY >= roomYStart && cellY < height;
        
        if (editorMode === 'regular' && (isTopBoundary || isRightBoundary)) {
            return null;
        }
        
        return { x: cellX, y: cellY, direction: direction };
    }
    
    return null;
}
