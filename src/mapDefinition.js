import { WALL_TYPES } from './constants.js';

/**
 * MapDefinition: 存储地图的静态、不可变定义。
 * 它像棋盘，定义了游戏的舞台，加载后不再改变。
 * 包含：地图尺寸、游戏模式、初始生命/体力、编辑模式、图层数量、
 *       每层的activeCells（地图方格）、初始墙体状态、初始实体位置
 */
export class MapDefinition {
    constructor(data) {
        this.width = data.width;
        this.height = data.height;
        this.gameMode = data.gameMode || 'exploration';
        this.initialHealth = data.initialHealth || 5;
        this.initialStamina = data.initialStamina || 100;
        this.editorMode = data.editorMode || 'regular';
        this.multiLayerMode = data.multiLayerMode || false;
        this.layerCount = data.layerCount || 1;
        
        // 全局楼梯数据（跨层）
        this.stairs = JSON.parse(JSON.stringify(data.stairs || []));

        // 每层的静态定义
        this.layers = [];
        for (let i = 0; i < this.layerCount; i++) {
            let layerData;
            if (data.layers && data.layers[i]) {
                layerData = data.layers[i];
            } else if (i === 0) {
                // 兼容单层地图：第0层使用顶层数据
                layerData = {
                    hWalls: data.hWalls,
                    vWalls: data.vWalls,
                    activeCells: data.activeCells || Array(this.height).fill(null).map(() => Array(this.width).fill(true)),
                    ghosts: data.initialGhosts || [],
                    items: data.items || [],
                    buttons: data.buttons || [],
                    stairs: (data.stairs || []).filter(s => s.layer === 0),
                    endPos: data.endPos,
                    customStartPos: data.customStartPos
                };
            } else {
                // 空层
                const empty = () => ({ type: WALL_TYPES.EMPTY, keys: 0 });
                layerData = {
                    hWalls: Array(this.height + 1).fill(null).map(() => Array(this.width).fill(null).map(empty)),
                    vWalls: Array(this.height).fill(null).map(() => Array(this.width + 1).fill(null).map(empty)),
                    activeCells: Array(this.height).fill(null).map(() => Array(this.width).fill(true)),
                    ghosts: [],
                    items: [],
                    buttons: [],
                    stairs: [],
                    endPos: null,
                    customStartPos: null
                };
            }

            this.layers.push({
                // activeCells 是静态的，不会改变
                activeCells: JSON.parse(JSON.stringify(layerData.activeCells || Array(this.height).fill(null).map(() => Array(this.width).fill(true)))),
                // 初始墙体状态（包括类型、方向、字母门初始状态等）
                initialWalls: {
                    h: JSON.parse(JSON.stringify(layerData.hWalls || [])),
                    v: JSON.parse(JSON.stringify(layerData.vWalls || []))
                },
                // 初始实体位置
                initialEntities: {
                    ghosts: JSON.parse(JSON.stringify(layerData.ghosts || [])),
                    items: JSON.parse(JSON.stringify(layerData.items || [])),
                    buttons: JSON.parse(JSON.stringify(layerData.buttons || [])),
                    stairs: JSON.parse(JSON.stringify((layerData.stairs || []).length > 0 ? layerData.stairs : (data.stairs || []).filter(s => s.layer === i))),
                    endPos: layerData.endPos ? { ...layerData.endPos } : null,
                    customStartPos: layerData.customStartPos ? { ...layerData.customStartPos } : null
                }
            });
        }

        // 确定玩家出生点
        this.playerStart = this._findPlayerStart(data);
    }

    _findPlayerStart(data) {
        // 优先使用明确指定的 playerStartLayer
        const startLayer = typeof data.playerStartLayer === 'number' ? data.playerStartLayer : 0;
        
        if (this.editorMode === 'free') {
            // 自由模式：查找带有 customStartPos 的图层
            for (let i = 0; i < this.layerCount; i++) {
                const layer = this.layers[i];
                if (layer && layer.initialEntities.customStartPos) {
                    return { 
                        x: layer.initialEntities.customStartPos.x, 
                        y: layer.initialEntities.customStartPos.y, 
                        layer: i 
                    };
                }
            }
            // 如果没找到，使用 mapStartPos 或默认
            if (data.mapStartPos) {
                return { x: data.mapStartPos.x, y: data.mapStartPos.y, layer: startLayer };
            }
        }
        
        // 常规模式或回退：使用 startPos 或默认
        const defaultStart = data.startPos || { x: 1, y: this.height - 2 };
        return { x: defaultStart.x, y: defaultStart.y, layer: startLayer };
    }
}
