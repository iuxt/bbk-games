package fmj.config

import java.sysGetSaveSlotCount

/**
 * 游戏配置管理
 */
object GameConfig {
    
    /**
     * 获取存档槽数量
     * 从 JavaScript window 变量中读取，如果未设置则默认为5
     */
    val saveSlotCount: Int by lazy {
        try {
            val count = sysGetSaveSlotCount()
            if (count > 0) count else 5
        } catch (e: Exception) {
            // 如果无法获取JavaScript变量，使用默认值5
            5
        }
    }
    
    /**
     * 生成存档文件名列表
     * 与 bbk 宿主约定一致：sav/gamesave{slot}-{romId}（app.js 存档管理器
     * 与胶水层的旧存档迁移都按 gamesave 命名；上游 H5 版曾改名 fmjsave）
     */
    val saveFileNames: Array<String> by lazy {
        Array(saveSlotCount) { "gamesave$it" }
    }
    
    /**
     * 生成存档位置数组（用于UI显示）
     */
    fun getSaveSlotPositions(): Array<IntArray> {
        val startY = 20
        val itemHeight = 20
        return Array(saveSlotCount) { index ->
            intArrayOf(68, startY + index * itemHeight)
        }
    }
    
    /**
     * 生成空存档文本数组
     */
    fun getEmptySaveTexts(): Array<String> {
        val emptyText = "空档案    "
        return Array(saveSlotCount) { emptyText }
    }
}