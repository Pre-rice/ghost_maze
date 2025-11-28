import { WALL_TYPES } from './constants.js';

/**
 * Renderer: 负责将游戏状态绘制到 Canvas 上。
 * 这是一个纯粹的渲染类，不包含任何游戏逻辑。
 */
export class Renderer {
    constructor(canvas, colors) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.colors = colors;

        // 为静态背景层创建离屏Canvas，用于性能优化
        this.staticLayerCanvas = document.createElement('canvas');
        this.staticLayerCtx = this.staticLayerCanvas.getContext('2d');
    }

    /**
     * 更新颜色配置
     * @param {object} newColors - 从 CSS 变量读取的新颜色对象
     */
    updateColors(newColors) {
        this.colors = newColors;
    }

    /**
     * 清除画布并显示初始欢迎信息
     */
    showInitialMessage() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const padding = 15;
        this.ctx.strokeStyle = this.colors.border || '#d9d9d9';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(padding, padding, this.canvas.width - 2 * padding, this.canvas.height - 2 * padding);
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = this.colors.text;
        this.ctx.font = '20px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('点击 "随机生成新地图" 或加载分享码开始游戏', this.canvas.width / 2, this.canvas.height / 2);
    }

    /**
     * 渲染静态背景层（地面、网格线）到离屏Canvas
     * @param {number} width - 地图宽度
     * @param {number} height - 地图高度
     * @param {number} cellSize - 单元格大小
     * @param {Array<Array<boolean>>} activeCells - 活动单元格位图
     * @param {boolean} isEditor - 是否为编辑器模式
     */
    renderStaticLayer(width, height, cellSize, activeCells, isEditor) {
        this.staticLayerCanvas.width = this.canvas.width;
        this.staticLayerCanvas.height = this.canvas.height;
        const ctx = this.staticLayerCtx;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (activeCells[y][x]) {
                    ctx.fillStyle = this.colors.ground;
                    ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    ctx.strokeStyle = this.colors.gridLine;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
                } else if (isEditor) {
                    ctx.fillStyle = "rgba(0,0,0,0)";
                    ctx.strokeStyle = this.colors.voidGrid;
                    ctx.lineWidth = 0.5;
                    ctx.setLineDash([2, 2]);
                    ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    ctx.setLineDash([]);
                }
            }
        }
    }

    /**
     * 主渲染函数，绘制完整的游戏画面
     * @param {object} renderData - 包含所有渲染所需数据的对象
     */
    draw(renderData) {
        const {
            state, player, ghosts, items, buttons, stairs,
            hWalls, vWalls, endPos, customStartPos,
            width, height, cellSize, drawOffset,
            seenCells, seenCellsPerLayer, debugVision,
            multiLayerMode, currentLayer, playerLayer
        } = renderData;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.translate(drawOffset.x, drawOffset.y);

        const now = Date.now();

        // 1. 静态层 (地面和网格)
        this.ctx.drawImage(this.staticLayerCanvas, 0, 0);

        // 2. 拖尾效果
        const drawTrail = (arr, color) => arr.forEach(p => {
            if (seenCells[p.y][p.x] || debugVision) {
                const age = now - p.timestamp;
                const alpha = 0.3 * (1 - age / 500);
                this.drawCircle(p.x, p.y, cellSize, color, alpha);
            }
        });
        drawTrail(player.trail, this.colors.player);
        ghosts.forEach(ghost => drawTrail(ghost.trail, this.colors.ghost));

        // 3. 战争迷雾
        if (!debugVision) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (renderData.activeCells[y][x] && !seenCells[y][x]) {
                        this.ctx.fillStyle = this.colors.unexplored;
                        this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    }
                }
            }
        }

        // 4. 墙体
        this.ctx.beginPath();
        const shouldDrawBoundary = (bx, by, isH) => {
            const isActive = (cx, cy) => (cx >= 0 && cx < width && cy >= 0 && cy < height) ? renderData.activeCells[cy][cx] : false;
            if (isH) {
                return isActive(bx, by - 1) !== isActive(bx, by);
            } else {
                return isActive(bx - 1, by) !== isActive(bx, by);
            }
        };

        // 横墙
        for (let y = 0; y <= height; y++) {
            for (let x = 0; x < width; x++) {
                const isBoundary = shouldDrawBoundary(x, y, true);
                const isActiveRow = (y < height && renderData.activeCells[y][x]) || (y > 0 && renderData.activeCells[y-1][x]);
                if (!isActiveRow && !isBoundary) continue;

                const isVisible = isBoundary || debugVision || 
                    (y < height && renderData.activeCells[y][x] && seenCells[y][x]) || 
                    (y > 0 && renderData.activeCells[y-1][x] && seenCells[y-1][x]);

                if (isVisible) {
                    if (hWalls[y][x].type > 0) this.drawWallOrDoor(x*cellSize, y*cellSize, (x+1)*cellSize, y*cellSize, hWalls[y][x], cellSize, state);
                    else if (isBoundary) this.drawWallOrDoor(x*cellSize, y*cellSize, (x+1)*cellSize, y*cellSize, {type:1}, cellSize, state);
                }
            }
        }
        // 竖墙
        for (let y = 0; y < height; y++) {
            for (let x = 0; x <= width; x++) {
                const isBoundary = shouldDrawBoundary(x, y, false);
                const isActiveCol = (x < width && renderData.activeCells[y][x]) || (x > 0 && renderData.activeCells[y][x-1]);
                if (!isActiveCol && !isBoundary) continue;

                const isVisible = isBoundary || debugVision || 
                    (x < width && renderData.activeCells[y][x] && seenCells[y][x]) || 
                    (x > 0 && renderData.activeCells[y][x-1] && seenCells[y][x-1]);

                if (isVisible) {
                    if (vWalls[y][x].type > 0) this.drawWallOrDoor(x*cellSize, y*cellSize, x*cellSize, (y+1)*cellSize, vWalls[y][x], cellSize, state);
                    else if (isBoundary) this.drawWallOrDoor(x*cellSize, y*cellSize, x*cellSize, (y+1)*cellSize, {type:1}, cellSize, state);
                }
            }
        }
        this.ctx.stroke();
        
        // 5. 墙角
        this.drawCorners(renderData, false);

        // 6. 楼梯
        stairs.filter(s => s.layer === currentLayer).forEach(stair => {
            if (seenCells[stair.y][stair.x] || debugVision) {
                this.drawStair(stair, cellSize);
            }
        });

        // 7. 实体
        if (endPos && (seenCells[endPos.y][endPos.x] || debugVision)) {
            this.drawCircle(endPos.x, endPos.y, cellSize, this.colors.endPoint);
        }
        ghosts.forEach(ghost => {
            if (seenCells[ghost.y][ghost.x] || debugVision) {
                this.drawCircle(ghost.x, ghost.y, cellSize, this.colors.ghost);
            }
        });
        if (!multiLayerMode || currentLayer === playerLayer) {
            this.drawCircle(player.x, player.y, cellSize, this.colors.player);
        }
        items.forEach(item => {
            if (seenCells[item.y][item.x] || debugVision) {
                this.drawItem(item, cellSize);
            }
        });
        buttons.forEach(button => {
            if (seenCells[button.y][button.x] || debugVision) {
                this.drawButton(button, cellSize);
            }
        });
        this.drawWallOverlays(renderData, true);
        
        this.ctx.restore();
    }

    drawCircle(x, y, cellSize, color, alpha = 1.0) {
        if (alpha <= 0) return;
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2, cellSize * 0.35, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.globalAlpha = 1.0;
    }

    drawItem(item, cellSize) {
        if (item.type === 'key') {
            const centerX = item.x * cellSize + cellSize / 2;
            const centerY = item.y * cellSize + cellSize / 2;
            const size = cellSize * 0.3;
            this.ctx.fillStyle = this.colors.key;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX, centerY - size);
            this.ctx.lineTo(centerX + size, centerY);
            this.ctx.lineTo(centerX, centerY + size);
            this.ctx.lineTo(centerX - size, centerY);
            this.ctx.closePath();
            this.ctx.fill();
        }
    }

    drawWallOrDoor(x1, y1, x2, y2, wallObject, cellSize, gameState, isHighlight = false) {
        const type = wallObject.type;

        if (isHighlight) {
            this.ctx.strokeStyle = this.colors.hoverHighlight;
            this.ctx.lineWidth = Math.max(3, cellSize / 8);
        } else {
            this.ctx.strokeStyle = this.colors.wall;
            if ([WALL_TYPES.SOLID, WALL_TYPES.DOOR, WALL_TYPES.GLASS].includes(type)) {
                this.ctx.lineWidth = Math.max(2, cellSize / 10);
            } else if ([WALL_TYPES.LOCKED, WALL_TYPES.ONE_WAY, WALL_TYPES.LETTER_DOOR].includes(type)) {
                this.ctx.lineWidth = Math.max(3, cellSize / 12); 
            }
        }
        
        if (type === WALL_TYPES.SOLID) {
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
        } else if (type === WALL_TYPES.GLASS) {
            // ... (implementation for glass wall)
        } else if (type === WALL_TYPES.LOCKED || type === WALL_TYPES.ONE_WAY || type === WALL_TYPES.LETTER_DOOR) {
            let isLetterDoorOpen = false;
            if (type === WALL_TYPES.LETTER_DOOR) {
                isLetterDoorOpen = wallObject.currentState === 'open';
            }

            if (isLetterDoorOpen) return;

            const isHorizontal = y1 === y2;
            const lockWidth = cellSize * 0.2;
            if (isHorizontal) {
                this.ctx.rect(x1, y1 - lockWidth / 2, cellSize, lockWidth);
            } else {
                this.ctx.rect(x1 - lockWidth / 2, y1, lockWidth, cellSize);
            }
        } else if (type === WALL_TYPES.DOOR) {
            // ... (implementation for door)
        }
    }

    drawWallOverlays(renderData, inGame = false) {
        const { hWalls, vWalls, width, height, cellSize, seenCells, debugVision, activeCells } = renderData;
        
        const drawTextOnWall = (x1, y1, x2, y2, text, color) => {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const fontSize = cellSize * 0.4;
            this.ctx.font = `bold ${fontSize}px sans-serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = 3;
            this.ctx.strokeText(text, centerX, centerY);
            this.ctx.fillStyle = color;
            this.ctx.fillText(text, centerX, centerY);
        };

        // Horizontal walls
        for (let y = 0; y <= height; y++) {
            for (let x = 0; x < width; x++) {
                const wall = hWalls[y][x];
                if (!wall || wall.type === WALL_TYPES.EMPTY) continue;
                
                const isVisible = !inGame || debugVision || (y > 0 && seenCells[y-1][x]) || (y < height && seenCells[y][x]);
                if (!isVisible) continue;

                if (wall.type === WALL_TYPES.LOCKED) {
                    drawTextOnWall(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.keys, this.colors.key);
                } else if (wall.type === WALL_TYPES.LETTER_DOOR) {
                    drawTextOnWall(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.letter, this.colors.key);
                } else if (wall.type === WALL_TYPES.ONE_WAY && wall.direction) {
                    this.drawArrow(x * cellSize, y * cellSize, (x + 1) * cellSize, y * cellSize, wall.direction, this.colors.key, true, cellSize);
                }
            }
        }
        // Vertical walls
        for (let y = 0; y < height; y++) {
            for (let x = 0; x <= width; x++) {
                const wall = vWalls[y][x];
                if (!wall || wall.type === WALL_TYPES.EMPTY) continue;

                const isVisible = !inGame || debugVision || (x > 0 && seenCells[y][x-1]) || (x < width && seenCells[y][x]);
                if (!isVisible) continue;

                if (wall.type === WALL_TYPES.LOCKED) {
                    drawTextOnWall(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.keys, this.colors.key);
                } else if (wall.type === WALL_TYPES.LETTER_DOOR) {
                    drawTextOnWall(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.letter, this.colors.key);
                } else if (wall.type === WALL_TYPES.ONE_WAY && wall.direction) {
                    this.drawArrow(x * cellSize, y * cellSize, x * cellSize, (y + 1) * cellSize, wall.direction, this.colors.key, true, cellSize);
                }
            }
        }
    }

    drawArrow(x1, y1, x2, y2, direction, color, withStroke, cellSize) {
        const centerX = (x1 + x2) / 2;
        const centerY = (y1 + y2) / 2;
        const fontSize = cellSize * 0.6; 

        this.ctx.save();
        this.ctx.translate(centerX, centerY);

        if (direction.dx === 1) { this.ctx.rotate(0); } 
        else if (direction.dx === -1) { this.ctx.rotate(Math.PI); } 
        else if (direction.dy === 1) { this.ctx.rotate(Math.PI / 2); } 
        else if (direction.dy === -1) { this.ctx.rotate(-Math.PI / 2); }

        this.ctx.scale(0.8, 1.0);

        this.ctx.font = `bold ${fontSize}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        if (withStroke) {
            this.ctx.strokeStyle = 'black';
            this.ctx.lineWidth = 3;
            this.ctx.strokeText('>', 0, 0);
        }
        this.ctx.fillStyle = color;
        this.ctx.fillText('>', 0, 0);

        this.ctx.restore();
    }

    drawButton(button, cellSize, isHighlight = false) {
        const centerX = button.x * cellSize + cellSize / 2;
        const centerY = button.y * cellSize + cellSize / 2;
        
        const buttonLength = cellSize * 0.5;
        const buttonWidth = cellSize * 0.2;

        let p1, p2, p3, p4;
        let letterCenterX, letterCenterY;

        switch (true) {
            case button.direction.dy === -1: // Top
                p1 = { x: centerX - buttonLength / 2, y: button.y * cellSize };
                p2 = { x: centerX + buttonLength / 2, y: button.y * cellSize };
                p3 = { x: centerX + buttonLength / 2, y: button.y * cellSize + buttonWidth };
                p4 = { x: centerX - buttonLength / 2, y: button.y * cellSize + buttonWidth };
                letterCenterX = centerX; letterCenterY = p1.y + buttonWidth / 2;
                break;
            // ... other cases
        }

        this.ctx.strokeStyle = isHighlight ? this.colors.hoverHighlight : this.colors.wall;
        this.ctx.lineWidth = isHighlight ? Math.max(3, cellSize / 8) : Math.max(2, cellSize / 10);
        this.ctx.beginPath();
        // ... drawing logic
        this.ctx.stroke();

        if (!isHighlight && button.letter) {
            // ... drawing letter logic
        }
    }

    drawStair(stair, cellSize, isHighlight = false, alpha = 1.0) {
        // ... implementation
    }

    drawCorners(renderData, isEditor = false) {
        // ... implementation
    }
}
