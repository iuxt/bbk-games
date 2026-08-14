package fmj.scene

import fmj.Global
import fmj.DebugLogger
import fmj.config.GameSettings
import fmj.characters.Character
import fmj.characters.Direction
import fmj.characters.NPC
import fmj.characters.Player
import fmj.characters.SceneObj
import fmj.combat.Combat
import fmj.gamemenu.ScreenGameMainMenu
import fmj.gamemenu.ScreenGameSettings
import fmj.graphics.Util
import fmj.graphics.TextRender
import fmj.lib.DatLib
import fmj.lib.ResMap
import fmj.script.ScriptProcess
import fmj.script.ScriptVM
import fmj.script.ScriptResources
import fmj.views.BaseScreen
import fmj.views.GameNode

import graphics.Canvas
import graphics.Point
import java.sysGetMapContainerState
import java.sysShowMapBase64
import java.sysUpdatePlayerPosition
import java.sysUpdateTreasureBoxes
import graphics.Bitmap
import kotlin.js.js

class ScreenMainGame(
    override val parent: GameNode,
    private val vm: ScriptVM): BaseScreen {
    
    override val screenName: String = "ScreenMainGame"

    val player: Player?
        get() = playerList.firstOrNull()

    var currentMap: ResMap? = null
        private set

    private val mMapScreenPos = Point() // 屏幕左上角对应地图的位置

    var scriptProcess: ScriptProcess

    var sceneName = ""
        set(name) {
            field = name
            SaveLoadGame.SceneName = name
        }

    /**
     * 按y值从大到小排序，确保正确的遮挡关系
     * @return
     */
    private// 选择排序
    val sortedNpcObjs: Array<NPC>
        get() {
            return mNPCObj.filterNot { it.isEmpty }
                    .sortedByDescending { it.posInMap.y }
                    .toTypedArray()
//            var arr = arrayOfNulls<NPC>(40)
//            var i = 0
//            for (j in 1..40) {
//                if (mNPCObj[j] != null) {
//                    arr[i++] = mNPCObj[j]
//                }
//            }
//
//            val arr2 = arrayOfNulls<NPC>(i)
//            System.arraycopy(arr, 0, arr2, 0, i)
//            arr = arr2
//            for (j in 0 until i) {
//                var max = j
//                for (k in j + 1 until i) {
//                    if (arr[k].posInMap.y > arr[max].posInMap.y) {
//                        max = k
//                    }
//                }
//                val tmp = arr[j]
//                arr[j] = arr[max]
//                arr[max] = tmp
//            }
//            return arr
        }
    val playerList: MutableList<Player>
        get() = game.playerList

    /**
     * id--NPC或场景对象 (1-40)
     */
    private var mNPCObj = Array(41) { NPC.empty }

    private val mCanWalk = object : NPC.ICanWalk {

        override fun canWalk(x: Int, y: Int): Boolean {
            return currentMap!!.canWalk(x, y) &&
                    getNpcFromPosInMap(x, y).isEmpty &&
                    player!!.posInMap != Point(x, y)
        }
    }

    init {
        if (SaveLoadGame.startNewGame) { // 开始新游戏
            Combat.FightDisable()

            // FMJSNLWQ 游戏不清理全局变量，保留 FMJYMQZQ 的进度数据
            val currentGame = java.sysGetChoiceLibName().uppercase()
            if (currentGame != "FMJSNLWQ" && currentGame != "FMJMVKXQ" && currentGame != "FMJHMAHQ") {
                ScriptResources.initGlobalVar()
            } else {
                println("===== FMJSNLWQ 新游戏：保留变量数据，不初始化全局变量和事件 =====")
            }

            ScriptResources.initGlobalEvents()

            SaveLoadGame.NpcObjs = mNPCObj
            SaveLoadGame.loadPlayers()
            playerList.clear()
            Player.sGoodsList.clear()
            Player.sMoney = 0
            scriptProcess = doStartChapter(1, 1)
            scriptProcess.start()
            println("===== 新游戏初始化完成 =====")
        } else { // 再续前缘
            println("===== 开始恢复游戏状态 =====")
            println("地图: ${SaveLoadGame.MapType}:${SaveLoadGame.MapIndex}")
            println("脚本: ${SaveLoadGame.ScriptType}:${SaveLoadGame.ScriptIndex}")

            // 🔧 先调整屏幕位置，让Player显示在中心
            adjustScreenPositionForPlayer()
            
            loadMap(SaveLoadGame.MapType, SaveLoadGame.MapIndex,
                    SaveLoadGame.MapScreenX, SaveLoadGame.MapScreenY)
            
            // 重新加载脚本并执行到当前位置
            println("重新初始化地图和NPC...")

            // 恢复存档中的所有NPC对象（包括普通NPC和SceneObj）
            val savedNpcs = SaveLoadGame.NpcObjs
            println("===== 恢复NPC列表 =====")
            for (i in savedNpcs.indices) {
                if (!savedNpcs[i].isEmpty) {
                    mNPCObj[i] = savedNpcs[i]
                    val npc = savedNpcs[i]
                    println("恢复NPC[$i]: type=${npc.type}, index=${npc.index}, name='${npc.name}', " +
                            "pos=(${npc.posInMap.x},${npc.posInMap.y}), isSceneObj=${npc is SceneObj}")
                }
            }
            println("总共恢复 ${mNPCObj.count { !it.isEmpty }} 个NPC")
            println("=========================")
            
            // 为所有NPC设置回调
            mNPCObj.filterNot { it.isEmpty }
                    .forEach { 
                        it.setICanWalk(mCanWalk)
                    }

            // 恢复原始脚本进程
            scriptProcess = SaveLoadGame.scriptProcess!!
            scriptProcess.goonExecute = true
            
            println("===== 游戏状态恢复完成 =====")
            
            // 更新SaveLoadGame中的NPC引用为当前场景的NPC数组
            SaveLoadGame.NpcObjs = mNPCObj
        }
    }

    fun callChapter(type: Int, index: Int) {
        val process = vm.loadScript(type, index)
        process.prev = scriptProcess
        scriptProcess = process
        process.start()
    }

    fun exitScript() {
        while (scriptProcess.prev != null) {
            scriptProcess.stop()
            scriptProcess = scriptProcess.prev!!
        }
        scriptProcess.stop()
    }

    private fun doStartChapter(type: Int, index: Int): ScriptProcess {
        val process = vm.loadScript(type, index)
        for (i in 1..40) {
            mNPCObj[i] = NPC.empty
        }
        // FMJSNLWQ 游戏不清理全局变量，保留 FMJYMQZQ 的进度数据
        val currentGame = java.sysGetChoiceLibName().uppercase()
        if (currentGame != "FMJSNLWQ" && currentGame != "FMJMVKXQ" && currentGame != "FMJHMAHQ") {
            ScriptResources.initLocalVar()
        } else {
            println("===== FMJSNLWQ 新游戏：保留initLocalVar，不初始化全局变量和事件 =====")
        }
        SaveLoadGame.ScriptType = type
        SaveLoadGame.ScriptIndex = index
        return process
    }

    fun startChapter(type: Int, index: Int) {
        scriptProcess.stop()
        scriptProcess = doStartChapter(type, index)
        scriptProcess.start()
    }

    override fun update(delta: Long) {
        if (scriptProcess.running) {
            scriptProcess.process()
            scriptProcess.update(delta)
            scriptProcess.timerStep(delta)
        } else if (Combat.IsActive()) { // TODO fix this test
            Combat.Update(delta)
        } else {
            mNPCObj.filterNot { it.isEmpty }
                   .forEach { it.update(delta) }
            scriptProcess.timerStep(delta)
        }
    }

    override fun draw(canvas: Canvas) {
        if (scriptProcess.running) {
            if (Combat.IsActive()) {
                Combat.Draw(canvas)
            } else {
                // 脚本运行时清屏
                canvas.drawColor(Global.COLOR_WHITE)
                // 检查脚本是否有需要绘制的内容
                val hasScriptContent = scriptProcess.hasDrawContent()
                if (!hasScriptContent) {
                    // 如果脚本没有绘制内容（如cmd_if/cmd_callback暂停执行），绘制场景避免闪屏
                    drawSceneWithoutClear(canvas)
                }
            }
            scriptProcess.draw(canvas)
        } else if (Combat.IsActive()) {
            Combat.Draw(canvas)
            return
        } else {
            drawScene(canvas)
        }
    }

    fun drawScene(canvas: Canvas) {
        // 清理整个屏幕以避免画面残留
        canvas.drawColor(Global.COLOR_WHITE)
        drawSceneWithoutClear(canvas)
    }
    
    fun drawSceneWithoutClear(canvas: Canvas) {
        if (currentMap != null) {
            val treasureBoxes = getTreasureBoxesForViewport()
            val mapContainerState = sysGetMapContainerState()
            currentMap!!.drawMap(canvas, mMapScreenPos.x, mMapScreenPos.y, treasureBoxes, mapContainerState)  // 根据设置决定是否显示事件点
        }

        var playY = 10000
        var hasPlayerBeenDrawn = false
        if (player != null) {
            playY = player!!.posInMap.y
        }

        val npcs = sortedNpcObjs
        for (i in npcs.indices.reversed()) {
            if (!hasPlayerBeenDrawn && playY < npcs[i].posInMap.y) {
                player!!.drawWalkingSprite(canvas, mMapScreenPos)
                hasPlayerBeenDrawn = true
            }
            npcs[i].drawWalkingSprite(canvas, mMapScreenPos)
        }
        if (player != null && !hasPlayerBeenDrawn) {
            player!!.drawWalkingSprite(canvas, mMapScreenPos)
        }
        Util.drawSideFrame(canvas)
    }

    override fun onKeyDown(key: Int) {
        DebugLogger.trace(DebugLogger.Tags.INPUT_EVENTS, "KeyInput", 
            "按键按下 - 键值: $key, 脚本运行: ${scriptProcess.running}, 战斗中: ${Combat.IsActive()}")
            
        if (scriptProcess.running) {
            scriptProcess.keyDown(key)
        } else if (Combat.IsActive()) {
            DebugLogger.debug(DebugLogger.Tags.INPUT_EVENTS, "CombatInput", 
                "战斗中按键处理 - 键值: $key")
            Combat.KeyDown(key)
            return
        } else if (player != null) {
            when (key) {
                Global.KEY_LEFT -> {
                    DebugLogger.trace(DebugLogger.Tags.PLAYER_ACTIONS, "Movement", "玩家向左移动")
                    walkLeft()
                }
                Global.KEY_RIGHT -> {
                    DebugLogger.trace(DebugLogger.Tags.PLAYER_ACTIONS, "Movement", "玩家向右移动")
                    walkRight()
                }
                Global.KEY_UP -> {
                    DebugLogger.trace(DebugLogger.Tags.PLAYER_ACTIONS, "Movement", "玩家向上移动")
                    walkUp()
                }
                Global.KEY_DOWN -> {
                    DebugLogger.trace(DebugLogger.Tags.PLAYER_ACTIONS, "Movement", "玩家向下移动")
                    walkDown()
                }
                Global.KEY_ENTER -> {
                    DebugLogger.debug(DebugLogger.Tags.PLAYER_ACTIONS, "Interaction", "玩家触发交互事件")
                    triggerSceneObjEvent()
                }
            }
        }
    }

    override fun onKeyUp(key: Int) {
        if (scriptProcess.running) {
            scriptProcess.keyUp(key)
        } else if (Combat.IsActive()) {
            Combat.KeyUp(key)
            return
        } else if (key == Global.KEY_CANCEL) {
            pushScreen(ScreenGameMainMenu(this))
        } else if (key == Global.KEY_HELP) {
            // H键 - 打开游戏设置菜单
            pushScreen(ScreenGameSettings(this))
        } else if (key == Global.KEY_DEBUG) {
            // 🛡️ 安全检查：只在开发模式下允许调试菜单
            if (Global.ENABLE_DEV_TOOLS) {
                println("🔧 Debug menu requested but moved to external dev tools")
                println("🔧 Use dev_tools pages for debugging functionality")
            } else {
                println("🛡️ Debug menu disabled in production mode")
            }
        }
    }

    fun gotoAddress(address: Int) {
        scriptProcess.gotoAddress(address)
    }

    fun triggerEvent(eventId: Int) {
        scriptProcess.triggerEvent(eventId)
    }

    /**
     * 按enter键后，检测并触发场景对象里的事件，如NPC对话，开宝箱等
     */
    private fun triggerSceneObjEvent() {
        val p = player
        var x = p!!.posInMap.x
        var y = p.posInMap.y
        when (p.direction) {
            Direction.East -> ++x
            Direction.North -> --y
            Direction.South -> ++y
            Direction.West -> --x
        }

        // NPC事件
        val npcId = getNpcIdFromPosInMap(x, y)
        if (npcId != 0) {
            val npc = getNPC(npcId)
            
            // 如果是宝箱，记录触发信息供cmd_if建立映射
            if (npc is SceneObj && npc.type == 4) {
                ScriptResources.currentTriggeringBox = ScriptResources.TriggeringBoxInfo(
                    mapType = SaveLoadGame.MapType,
                    mapIndex = SaveLoadGame.MapIndex,
                    npcId = npcId,
                    boxType = npc.type,
                    boxIndex = npc.index,
                    x = npc.posInMap.x,
                    y = npc.posInMap.y
                )
                println("[TRIGGER_BOX] Triggering box $npcId at map ${SaveLoadGame.MapType}:${SaveLoadGame.MapIndex}, pos=(${npc.posInMap.x},${npc.posInMap.y})")
            }
            
            scriptProcess.triggerEvent(npcId)
            return
        } else if (triggerMapEvent(x, y)) {// 地图切换
        }
    }

    /**
     * 场景切换
     * 如果地图(x,y)有地图事件，就触发该事件
     * @param x
     * @param y
     */
    private fun triggerMapEvent(x: Int, y: Int): Boolean {
        // println("triggerMapEvent: x=$x y=$y")
        if (currentMap != null) {
            val id = currentMap!!.getEventNum(x, y)
            if (id != 0) {
                scriptProcess.triggerEvent(id + 40)
                return true
            }
        }
        // 未触发地图事件，随机战斗
        Combat.StartNewRandomCombat()
        return false
    }

    /**
     * 检测玩家是否被完全困住（四个方向都无法移动）
     * @return true 如果玩家被困
     */
    private fun isPlayerStuck(): Boolean {
        if (player == null || currentMap == null) return false
        
        val (x, y) = player!!.posInMap
        
        // 检查四个方向是否都无法通行
        val canGoLeft = canPlayerWalkNormally(x - 1, y)
        val canGoRight = canPlayerWalkNormally(x + 1, y)
        val canGoUp = canPlayerWalkNormally(x, y - 1)
        val canGoDown = canPlayerWalkNormally(x, y + 1)
        
        val isStuck = !canGoLeft && !canGoRight && !canGoUp && !canGoDown
        
        if (isStuck) {
            println("WARNING: Player is stuck at position ($x, $y)! Enabling obstacle bypass.")
            DebugLogger.warn(DebugLogger.Tags.PLAYER_ACTIONS, "PlayerStuck", 
                "玩家被困在位置 ($x, $y)，启用穿越障碍物模式")
        }
        
        return isStuck
    }
    
    /**
     * 正常的可行走检查（不包括穿越模式）
     */
    private fun canPlayerWalkNormally(x: Int, y: Int): Boolean {
        return if (currentMap == null) false else currentMap!!.canPlayerWalk(x, y) && getNpcFromPosInMap(x, y).isEmpty
    }
    
    /**
     * 地图的(x,y)处，是否可行走，是否有NPC
     * 如果玩家被困或开启穿墙模式，允许穿越障碍物
     * @param x
     * @param y
     * @return
     */
    private fun canPlayerWalk(x: Int, y: Int): Boolean {
        // 首先检查地图边界，无论什么模式都不能超出地图范围
        if (currentMap == null) return false
        val offset = 4
        if (x < -offset || x >= currentMap!!.mapWidth + offset || y < -offset || y >= currentMap!!.mapHeight + offset) {
            return false
        }
        
        // 进行正常的可行走检查
        if (canPlayerWalkNormally(x, y)) {
            return true
        }
        
        // 如果开启了穿墙模式，允许穿越障碍物（但仍不能穿越NPC和地图边界）
        if (GameSettings.allowWallWalking) {
            val npc = getNpcFromPosInMap(x, y)
            if (npc.isEmpty) {
                return true
            }
        }
        
        // 如果正常不能行走且未开启穿墙模式，检查玩家是否被困
        // 如果被困，允许穿越障碍物（但仍不能穿越NPC和地图边界）
        if (!GameSettings.allowWallWalking && isPlayerStuck()) {
            // 被困时只检查是否有NPC，忽略地形障碍
            val npc = getNpcFromPosInMap(x, y)
            if (npc.isEmpty) {
                println("Player stuck - allowing obstacle bypass to position ($x, $y)")
                return true
            }
        }
        
        return false
    }

    private fun walkLeft() {
        val (x, y) = player!!.posInMap
        triggerMapEvent(x - 1, y)
        if (canPlayerWalk(x - 1, y)) {
            player!!.walk(Direction.West)
            // 相机锁死跟随：每步卷动，玩家固定在屏幕 (4,3)
            mMapScreenPos.x -= 1
            SaveLoadGame.MapScreenX = mMapScreenPos.x
            // 更新玩家位置到前端
            updatePlayerPositionInBrowser()
        } else {
            player!!.walkStay(Direction.West)
        }
    }

    private fun walkUp() {
        val (x, y) = player!!.posInMap
        triggerMapEvent(x, y - 1)
        if (canPlayerWalk(x, y - 1)) {
            player!!.walk(Direction.North)
            // 同 walkLeft：相机锁死跟随
            mMapScreenPos.y -= 1
            SaveLoadGame.MapScreenY = mMapScreenPos.y
            // 更新玩家位置到前端
            updatePlayerPositionInBrowser()
        } else {
            player!!.walkStay(Direction.North)
        }
    }

    private fun walkRight() {
        val (x, y) = player!!.posInMap
        triggerMapEvent(x + 1, y)
        if (canPlayerWalk(x + 1, y)) {
            // 相机锁死跟随（原版设计）：每步卷动，玩家固定在屏幕 (4,3)；
            // 地图边缘的可行走余量保证相机不会越出地图。
            mMapScreenPos.x += 1
            SaveLoadGame.MapScreenX = mMapScreenPos.x
            player!!.walk(Direction.East)
            // 更新玩家位置到前端
            updatePlayerPositionInBrowser()
        } else {
            player!!.walkStay(Direction.East)
        }
    }

    private fun walkDown() {
        val (x, y) = player!!.posInMap
        triggerMapEvent(x, y + 1)
        if (canPlayerWalk(x, y + 1)) {
            // 同 walkRight：相机锁死跟随
            mMapScreenPos.y += 1
            SaveLoadGame.MapScreenY = mMapScreenPos.y
            player!!.walk(Direction.South)
            // 更新玩家位置到前端
            updatePlayerPositionInBrowser()
        } else {
            player!!.walkStay(Direction.South)
        }
    }

    /**
     * 载入号码n,类型m的地图，初始位置（x，y）
     */
    fun loadMap(type: Int, index: Int, x: Int, y: Int) {
        // 换图前记住玩家在屏幕上的相对位置（经典主机 RPG 行为：换图时
        // 玩家视觉上留在原地，地图在脚下更换）。上游 H5 改屏时曾把玩家
        // 强制摆到 19×12 视口的"中心"(9,5)——在 9×6 的设备原生视口下
        // 玩家被推出画面右下角，只能看到其左上方的一角地图。
        var tmpP: Point? = null
        if (player != null && currentMap != null) {
            tmpP = player!!.getPosOnScreen(mMapScreenPos)
        }
        // 加载新地图
        val mapRes = DatLib.getRes(DatLib.ResType.MAP, type, index)
        if (mapRes is ResMap) {
            currentMap = mapRes
        } else {
            println("Warning: Failed to load map type=$type, index=$index - got non-ResMap object or null")
            return
        }
        mMapScreenPos.set(x, y)
        if (tmpP != null) {
            player!!.setPosOnScreen(tmpP.x, tmpP.y, mMapScreenPos)
            val mapPos = player!!.posInMap
            println("loadMap: Player at (${mapPos.x}, ${mapPos.y})")
        }

        SaveLoadGame.MapType = type
        SaveLoadGame.MapIndex = index
        SaveLoadGame.MapScreenX = mMapScreenPos.x
        SaveLoadGame.MapScreenY = mMapScreenPos.y
        
        // 如果当前没有场景名称，使用地图资源中的名称
        if (SaveLoadGame.SceneName.isEmpty() && currentMap?.mapName?.isNotEmpty() == true) {
            SaveLoadGame.SceneName = currentMap!!.mapName!!
            sceneName = currentMap!!.mapName!!
            println("loadMap: Set scene name from map resource: ${currentMap!!.mapName}")
        }

        println("loadMap type=$type index=$index x=$x y=$y")
        println("Current scene class: ScreenMainGame")
        if (currentMap != null) {
            println("Loaded map class: ResMap")
        }
        
        // 生成当前地图的base64编码并显示
        generateMapBase64()
                
        updatePlayerPositionInBrowser()
        println("Immediate player position update")
                
        // 延迟更新，确保前端准备好
        js("setTimeout")(
            { 
                updatePlayerPositionInBrowser()
                println("Delayed player position update (100ms)")
            },
            100  // 延迟100ms
        )
        println("=== loadMap 结束 ===")
    }
    
    /**
     * 生成当前地图的base64编码并发送到前端显示
     */
    fun generateMapBase64() {
        if (currentMap == null) return
        
        try {
            // 计算完整地图的尺寸（每个格子16x16像素）
            val fullMapWidth = currentMap!!.mapWidth * 16
            val fullMapHeight = currentMap!!.mapHeight * 16
            
            println("Generating full map: ${currentMap!!.mapWidth}x${currentMap!!.mapHeight} tiles = ${fullMapWidth}x${fullMapHeight} pixels")
            
            // 创建用于完整地图的Bitmap
            val fullMapBitmap = Bitmap(fullMapWidth, fullMapHeight)
            val fullMapCanvas = Canvas(fullMapBitmap)
            
            // 绘制完整地图（从0,0开始绘制整个地图，不包含角色和NPC）
            fullMapCanvas.drawColor(Global.COLOR_WHITE)  // 设置背景色
            val showEvents = true  // 总是显示事件触发点
            val treasureBoxes = getTreasureBoxes()
            currentMap!!.drawWholeMap(fullMapCanvas, 0, 0, showEvents, treasureBoxes)
            
            // 转换为base64编码
            val base64String = bitmapToBase64(fullMapBitmap)
            
            // 调用JavaScript函数显示地图
            if (base64String.isNotEmpty()) {
                showMapInBrowser(base64String)
                println("Full map base64 generated and sent to frontend (${base64String.length} chars)")
            }
        } catch (e: Exception) {
            println("Error generating full map base64: ${e.message}")
        }
    }
    
    /**
     * 绘制完整地图（不包含人物和NPC）
     */
    private fun drawFullMap(canvas: Canvas) {
        if (currentMap == null) return
        
        // 清理画布
        canvas.drawColor(Global.COLOR_WHITE)
        
        // 使用ResMap的drawWholeMap方法绘制完整地图，从(0,0)开始绘制
        val showEvents = true  // 总是显示事件触发点
        val treasureBoxes = getTreasureBoxes()
        currentMap!!.drawWholeMap(canvas, 0, 0, showEvents, treasureBoxes)
    }
    
    /**
     * 调用浏览器JavaScript函数显示地图
     */
    private fun showMapInBrowser(base64String: String) {
        try {
            println("Generated base64 string length: ${base64String.length}")
            // 使用系统函数调用JavaScript函数
            sysShowMapBase64(base64String)
        } catch (e: Exception) {
            println("Error calling showMapBase64: ${e.message}")
            // 如果JavaScript调用失败，至少输出到Kotlin控制台
            println("Map Base64: $base64String")
        }
    }
    
    /**
     * 将玩家位置信息同步到前端
     */
    fun updatePlayerPositionInBrowser() {
        if (player == null || currentMap == null) return
        
        try {
            val playerPos = player!!.posInMap
            val mapWidth = currentMap!!.mapWidth
            val mapHeight = currentMap!!.mapHeight
            
            // 计算玩家在地图中的相对位置（0-1之间的比例）
            val relativeX = playerPos.x.toDouble() / mapWidth
            val relativeY = playerPos.y.toDouble() / mapHeight
                        
            // 调用系统函数更新玩家位置
            sysUpdatePlayerPosition(relativeX, relativeY, playerPos.x, playerPos.y, mapWidth, mapHeight)
            
            // 同时更新宝箱信息
            updateTreasureBoxesInBrowser()
        } catch (e: Exception) {
            println("Error updating player position: ${e.message}")
        }
    }
    
    /**
     * 获取地图上的所有事件触发点
     */
    fun getEventTriggers(): List<Pair<Point, Int>> {
        val triggers = mutableListOf<Pair<Point, Int>>()
        if (currentMap == null) return triggers
        
        for (y in 0 until currentMap!!.mapHeight) {
            for (x in 0 until currentMap!!.mapWidth) {
                val eventNum = currentMap!!.getEventNum(x, y)
                if (eventNum != 0) {
                    triggers.add(Pair(Point(x, y), eventNum))
                }
            }
        }
        return triggers
    }
    
    /**
     * 将宝箱信息同步到前端
     */
    fun updateTreasureBoxesInBrowser() {
        if (currentMap == null) return
        
        try {
            val mapWidth = currentMap!!.mapWidth
            val mapHeight = currentMap!!.mapHeight
            
            // 构建所有NPC对象的JSON数组
            val allObjects = mutableListOf<String>()
            
            mNPCObj.forEachIndexed { index, npc ->
                if (npc is SceneObj) {
                    // println("npc info: ${npc.name} type:${npc.type} step:${npc.step} index:${npc.index} posInMap: ${npc.posInMap.x}, ${npc.posInMap.y}")
                }   
                if (index > 0 && npc is SceneObj && !npc.isEmpty) {
                    val x = npc.posInMap.x
                    val y = npc.posInMap.y
                    val name = npc.name
                    if (name == "挡路石") {
                        println("移除 挡路石")
                        return@forEachIndexed  // 使用 return@forEachIndexed 代替 continue
                    }

                    // println("npc info: ${npc.name} type:${npc.type} step:${npc.step} index:${npc.index}")
                    // NPC
                    var type = ""
                    if (npc.type == 2) {
                        type = "npc"
                    }
                    else if (npc.type == 4) {
                        // 宝箱
                        if (npc.index == 18 || npc.index == 15) {
                            type = "treasure"
                        }
                        else {
                            type = "npc"
                        }
                    }
                    else if (npc.type == 3) {
                        type = "boss"
                    }

                    // 检查是否已收集（对于SceneObj，step=2表示已收集）
                    var isCollected = npc.step == 2
                    val boxKey = "${SaveLoadGame.MapType}_${SaveLoadGame.MapIndex}_${x}_${y}_${npc.type}_${npc.index}"
                    if (ScriptResources.isBoxCollected(boxKey)) {
                        isCollected = true
                    }

                    // 检查是否激活状态（如伏魔灯等动态对象）
                    val isActive = npc.state == Character.State.ACTIVE
                    
                    // 确保生成正确的JSON格式
                    val escapedName = name.replace("\"", "\\\"")  // 转义名称中的引号
                    val objectJson = """{"x":$x,"y":$y,"name":"$escapedName","type":"$type","isCollected":$isCollected,"isActive":$isActive,"id":$index}"""
                    allObjects.add(objectJson)
                }
            }
            
            // 添加事件触发点到对象列表
            // val eventTriggers = getEventTriggers()
            // for ((pos, eventNum) in eventTriggers) {
            //     val escapedName = "事件触发点 #$eventNum"
            //     val triggerJson = """{"x":${pos.x},"y":${pos.y},"name":"$escapedName","type":"trigger","eventNum":$eventNum,"id":0}"""
            //     allObjects.add(triggerJson)
            // }
            
            val allObjectsJson = allObjects.joinToString(",", "[", "]")
            
            // println("Sending ${allObjects.size} objects to frontend (including ${eventTriggers.size} event triggers)")
            
            // 调用系统函数更新所有对象信息
            sysUpdateTreasureBoxes(allObjectsJson, mapWidth, mapHeight)
        } catch (e: Exception) {
            println("Error updating treasure boxes: ${e.message}")
            e.printStackTrace()
        }
    }
    
    /**
     * 将Bitmap转换为base64编码的PNG
     */
    private fun bitmapToBase64(bitmap: Bitmap): String {
        try {
            // 创建一个HTML Canvas来绘制bitmap
            val htmlCanvas: dynamic = js("document.createElement('canvas')")
            htmlCanvas.width = bitmap.width
            htmlCanvas.height = bitmap.height
            val ctx: dynamic = htmlCanvas.getContext("2d")
            
            // 创建ImageData
            val imageData: dynamic = ctx.createImageData(bitmap.width, bitmap.height)
            val data: dynamic = imageData.data
            
            // 将bitmap的buffer数据复制到ImageData
            val buffer = bitmap.buffer
            for (i in buffer.indices) {
                val color = buffer[i]
                val baseIndex = i * 4
                data[baseIndex] = color.r // Red
                data[baseIndex + 1] = color.g // Green
                data[baseIndex + 2] = color.b // Blue
                data[baseIndex + 3] = color.a // Alpha
            }
            
            // 将ImageData绘制到canvas
            ctx.putImageData(imageData, 0, 0)
            
            // 转换为base64
            val dataUrl: String = htmlCanvas.toDataURL("image/png")
            return if (dataUrl.startsWith("data:image/png;base64,")) {
                dataUrl.substring(22) // 移除 "data:image/png;base64," 前缀
            } else {
                ""
            }
        } catch (e: Exception) {
            println("Error converting bitmap to base64: ${e.message}")
            return ""
        }
    }

    fun setMapScreenPos(x: Int, y: Int) {
        mMapScreenPos.set(x, y)
    }

    /**
     * 创建主角号码actor，位置为（x，y）
     * @param actorId
     * @param x
     * @param y
     */
    fun createActor(actorId: Int, x: Int, y: Int) {
        val p = SaveLoadGame.getPlayerByIndex(actorId) ?: return

        // 移除已存在的同ID玩家
        playerList.removeAll { it.index == actorId }

        // 添加玩家并设置位置
        playerList.add(p)
        p.setPosOnScreen(x, y, mMapScreenPos)

        // 检查位置是否合理
        if (currentMap != null) {
            val mapPos = p.posInMap
            val mapWidth = currentMap!!.mapWidth
            val mapHeight = currentMap!!.mapHeight

            // 如果位置超出地图边界，修正它
            if (mapPos.x >= mapWidth || mapPos.y >= mapHeight || mapPos.x < 0 || mapPos.y < 0) {
                val safeX = minOf(maxOf(0, mapPos.x), mapWidth - 1)
                val safeY = minOf(maxOf(0, mapPos.y), mapHeight - 1)
                p.setPosInMap(safeX, safeY)
                println("createActor: Fixed position from (${mapPos.x}, ${mapPos.y}) to ($safeX, $safeY)")
            }
        }

        println("createActor: actorId=$actorId at map pos (${p.posInMap.x}, ${p.posInMap.y})")

        // 如果当前正在战斗中，将新Player同步添加到战斗系统
        if (Combat.IsActive()) {
            println("createActor: Combat is active, attempting to add player to combat")
            Combat.addPlayerToCombat(p)
        }

        // 如果是新游戏且这是第一个主角，并且最大的等级为0 的时候（新版魔塔），添加默认物品
        if (SaveLoadGame.startNewGame && playerList.size == 1 && Player.sGoodsList.goodsTypeNum == 0 && p.levelupChain.maxLevel == 0) {
            addDefaultItems()
        }

        // 立即更新玩家位置到前端
        updatePlayerPositionInBrowser()
    }

    /**
     * 为新游戏添加默认物品
     */
    private fun addDefaultItems() {
        println("===== 为新游戏添加默认物品 =====")

        // 物品类型说明：
        // 1-7: 装备类型
        // 8: 投掷类（暗器）
        // 9: 药品类
        // 10: 仙药类
        // 11: 毒物类
        // 12: 兴奋剂类
        // 13: 土遁类
        // 14: 剧情道具类

        // 添加潮海衣，抵御boos的攻击带乱
        Player.sGoodsList.addGoods(2, 3, 1)   // 假设 9,1 是止血草，添加个
    }

    fun deleteActor(actorId: Int) {
        for (i in 0 until playerList.size) {
            if (playerList[i].index == actorId) {
                playerList.removeAt(i)
                break
            }
        }
    }

    fun getPlayer(actorId: Int): Player? {
        return SaveLoadGame.playerDb.firstOrNull { it.index == actorId }
    }

    /**
     * 创建配角号码npc，位置为（x，y），id为操作号
     * @param id
     * @param npc
     * @param x
     * @param y
     */
    fun createNpc(id: Int, npc: Int, x: Int, y: Int): NPC {
        val npcobj = DatLib.getRes(DatLib.ResType.ARS, 2, npc) as NPC
        npcobj.setPosInMap(x, y)
        npcobj.setICanWalk(mCanWalk)
        mNPCObj[id] = npcobj
        
        // 如果主角位置不合理，将主角放在NPC旁边
        if (player != null && currentMap != null) {
            val mapWidth = currentMap!!.mapWidth
            val mapHeight = currentMap!!.mapHeight
            val playerPos = player!!.posInMap
            
            // 检查主角位置是否超出地图边界
            if (playerPos.x >= mapWidth || playerPos.y >= mapHeight || playerPos.x < 0 || playerPos.y < 0) {
                // 将主角放在NPC旁边
                var newX = x + 1  // 默认放在右侧
                var newY = y
                
                // 如果右侧超出边界，尝试其他方向
                if (newX >= mapWidth) {
                    newX = x - 1  // 左侧
                    if (newX < 0) {
                        newX = x
                        newY = y + 1  // 下方
                        if (newY >= mapHeight) {
                            newY = y - 1  // 上方
                        }
                    }
                }
                
                // 确保在边界内
                newX = minOf(maxOf(0, newX), mapWidth - 1)
                newY = minOf(maxOf(0, newY), mapHeight - 1)
                
                player!!.setPosInMap(newX, newY)
                
                // 调整屏幕位置（9×6 设备原生视口：玩家锚在屏幕 (4,3) 附近）
                val screenX = maxOf(0, minOf(x - 4, mapWidth - 10))
                val screenY = maxOf(0, minOf(y - 3, mapHeight - 6))
                mMapScreenPos.set(screenX, screenY)
                
                println("createNpc: Fixed player to ($newX, $newY) near NPC at ($x, $y)")
            }
        }
        
        return npcobj
    }

    fun deleteNpc(id: Int) {
        mNPCObj[id] = NPC.empty
    }

    fun deleteAllNpc() {
        for (i in 0..40) {
            mNPCObj[i] = NPC.empty
        }
    }

    fun getNPC(id: Int): NPC {
        return mNPCObj[id]
    }

    fun setControlPlayer(id: Int) {
        val p = playerList.find { it.index == id }
        p?.let { newPlayer ->
            val oldPos = player?.posInMap
            oldPos?.let {
                newPlayer.setPosInMap(it.x, it.y)
            }
            playerList.remove(newPlayer)
            playerList.add(0, newPlayer)
        }
    }

    fun isNpcVisible(npc: NPC): Boolean {
        val (x, y) = npc.getPosOnScreen(mMapScreenPos)
        return x >= 0 && x < ResMap.WIDTH &&
                y >= 0 && y <= ResMap.HEIGHT
    }

//    fun isNpcVisible(id: Int): Boolean {
//        return isNpcVisible(getNPC(id))
//    }

    /**
     * 得到地图的(x,y)处的NPC，没有就返回null
     * @param x
     * @param y
     * @return
     */
    fun getNpcFromPosInMap(x: Int, y: Int): NPC {
        return mNPCObj[getNpcIdFromPosInMap(x, y)]
    }

    private fun getNpcIdFromPosInMap(x: Int, y: Int): Int {
        val id = mNPCObj.indexOfFirst { !it.isEmpty && it.posInMap == Point(x, y) }
        return if (id == -1) 0 else id
    }

    /**
     * 建一个宝箱，宝箱号码boxindex(角色图片，type为4)，
     * 位置为（x，y），id为操作号（与NPC共用)
     */
    fun createBox(id: Int, boxIndex: Int, x: Int, y: Int): SceneObj {
        val box = DatLib.getRes(DatLib.ResType.ARS, 4, boxIndex) as SceneObj
        box.setPosInMap(x, y)
        
        // 构建宝箱的唯一标识
        val boxKey = "${SaveLoadGame.MapType}_${SaveLoadGame.MapIndex}_${x}_${y}_${box.type}_${box.index}"
        
        // 宝箱状态管理策略（三层保障）
        
        // 1. 优先从存档中的NPC对象恢复状态
        val savedBox = SaveLoadGame.NpcObjs.getOrNull(id)
        if (savedBox is SceneObj && savedBox.posInMap.x == x && savedBox.posInMap.y == y && savedBox.step == 2) {
            box.step = 2
            // println("createBox: Box $id restored from NPC save, step=2 (collected)")
        } 
        // 2. 检查宝箱映射表和全局事件
        else if (ScriptResources.isBoxCollected(boxKey)) {
            box.step = 2
            val eventId = ScriptResources.getBoxEventId(boxKey)
            // println("createBox: Box $id at ($x,$y) is collected based on event $eventId")
        } 
        // 3. 新宝箱默认未收集
        else {
            // println("createBox: Box $id at ($x,$y) created with default step=${box.step}")
        }
        
        mNPCObj[id] = box
        
        // 如果已收集，延迟更新前端显示
        if (box.step == 2) {
            js("setTimeout")({
                updateTreasureBoxesInBrowser()
            }, 100)
        }
        
        return box
    }

    fun deleteBox(id: Int) {
        mNPCObj[id] = NPC.empty
    }

    /**
     * 同步当前NPC状态到存档系统
     */
    fun syncNPCStateToSave() {
        SaveLoadGame.NpcObjs = mNPCObj.copyOf()
    }
    
    /**
     * 获取当前场景中所有宝箱的位置和信息
     */
    private fun getTreasureBoxes(): List<ResMap.TreasureBoxInfo> {
        val treasureBoxes = mutableListOf<ResMap.TreasureBoxInfo>()
        
        // 遍历所有NPC对象，查找SceneObj类型的宝箱
        mNPCObj.forEachIndexed { index, npc ->
            if (index > 0 && npc is SceneObj && !npc.isEmpty) {
                // step=2表示已获取状态，其他值表示未获取
                val isCollected = npc.step == 2
                
                treasureBoxes.add(ResMap.TreasureBoxInfo(
                    npc.posInMap.x,
                    npc.posInMap.y,
                    npc.name,
                    isCollected
                ))
            }
        }
        
        return treasureBoxes
    }
    
    /**
     * 获取当前场景中用于游戏视口显示的宝箱信息（根据设置决定是否显示）
     */
    private fun getTreasureBoxesForViewport(): List<ResMap.TreasureBoxInfo> {
        // 检查是否应该在游戏视口中显示宝箱
        val mapContainerState = js("window.mapContainerState || false").unsafeCast<Boolean>()
        if (!mapContainerState) {
            return emptyList()
        }
        
        return getTreasureBoxes()
    }
    
    
    /**
     * 根据Player位置调整屏幕坐标，让Player显示在屏幕中心
     * 读档时调用，确保Player在屏幕中央显示
     */
    private fun adjustScreenPositionForPlayer() {
        val firstPlayer = playerList.firstOrNull()
        if (firstPlayer != null) {
            // 获取Player在地图中的位置
            val playerMapX = firstPlayer.posInMap.x
            val playerMapY = firstPlayer.posInMap.y
            
            // 计算让Player显示在屏幕锚点所需的屏幕坐标
            // 9×6 视口的玩家锚点是 (4, 3)（与原版行走跟随设计一致）
            val centerOffsetX = 4  // 屏幕锚点X偏移
            val centerOffsetY = 3  // 屏幕锚点Y偏移
            
            val newScreenX = playerMapX - centerOffsetX
            val newScreenY = playerMapY - centerOffsetY
            
            // 记录调整前的屏幕位置
            val oldScreenX = SaveLoadGame.MapScreenX
            val oldScreenY = SaveLoadGame.MapScreenY
            
            // 更新SaveLoadGame中的屏幕坐标
            SaveLoadGame.MapScreenX = newScreenX
            SaveLoadGame.MapScreenY = newScreenY
            
            DebugLogger.info(DebugLogger.Tags.CHARACTER_STATE, "AdjustScreenPos", 
                "根据Player位置调整屏幕坐标 - Player地图位置: ($playerMapX, $playerMapY), 屏幕坐标: ($oldScreenX, $oldScreenY) -> ($newScreenX, $newScreenY)")
        } else {
            DebugLogger.warn(DebugLogger.Tags.CHARACTER_STATE, "AdjustScreenPos", 
                "无法调整屏幕位置 - 未找到Player")
        }
    }
    
}
