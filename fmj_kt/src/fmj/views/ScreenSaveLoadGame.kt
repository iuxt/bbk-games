package fmj.views

import fmj.Global
import fmj.ScreenViewType
import fmj.config.GameConfig
import fmj.graphics.TextRender
import fmj.graphics.Util
import fmj.lib.DatLib
import fmj.lib.ResImage
import fmj.scene.SaveLoadGame
import fmj.script.ScriptResources

import graphics.Canvas
import java.*

class ScreenSaveLoadGame(override val parent: GameNode, private val mOperate: Operate, private val popDepth: Int = 3) : BaseScreen {
    override val screenName: String = "ScreenSaveLoadGame(${mOperate.name})"

    // 动态存档数量配置
    private val saveSlotCount: Int = GameConfig.saveSlotCount
    private val mTextPos = GameConfig.getSaveSlotPositions()
    private var index = 0
    private val mEmpty = "空档案    "
    private val mText = GameConfig.getEmptySaveTexts()
    private val mHeadImgs = ArrayList<ArrayList<ResImage>>()

    private val mFileNames = GameConfig.saveFileNames

    private val mImgBg: ResImage    // 背景图片

    var callback: (() -> Unit)? = null

    enum class Operate {
        SAVE, // 保存进度
        LOAD    // 读取进度
    }

    init {
        mImgBg = DatLib.getRes(DatLib.ResType.PIC, 2,
                if (mOperate == Operate.LOAD) 16 else 15) as ResImage
        
        // 初始化存档槽的头像列表
        for (i in 0 until saveSlotCount) {
            mHeadImgs.add(ArrayList())
        }
        
        // 加载存档信息
        for (i in 0 until saveSlotCount) {
            val file = File("sav/" + mFileNames[i])
            if (file.exists()) {
                mText[i] = format(getSceneNameAndHeads(file, mHeadImgs[i]))
            }
        }
    }

    private fun format(s: String): String {
        var tmp = s
        while (tmp.gbkBytes().size < mEmpty.gbkBytes().size)
            tmp += " "
        return tmp
    }

    private fun getSceneNameAndHeads(f: File, heads: ArrayList<ResImage>): String {
        val file = objectInputOf(f)
        val name =  file.readString()
        val actorNum =  file.readInt()
        for (i in 0 until actorNum) {
            heads.add(DatLib.getRes(DatLib.ResType.PIC, 1,  file.readInt()) as ResImage)
        }
        file.close()
        return name
    }

    override fun update(delta: Long) {}

    override fun draw(canvas: Canvas) {
        // 160×96 设备原生布局：ROM 背景图 + 头像 + 每槽一行文案。
        // （上游 H5 改屏时重设计过：25px 高的条目 ×5 在 96 高的屏幕上
        // 只能显示不到两行，头像/文本也被推到屏幕外。）
        mImgBg.draw(canvas, 1, 0, 0)
        for (i in 0 until saveSlotCount) {
            for (j in 0 until mHeadImgs[i].size) {
                val img = mHeadImgs[i][j]
                img.draw(canvas, 7, 8 + 20 * j, mTextPos[i][1] - 6)
            }
            TextRender.drawText(canvas, mText[i], mTextPos[i][0], mTextPos[i][1])
        }
        TextRender.drawSelText(canvas, mText[index], mTextPos[index][0], mTextPos[index][1])
    }

    override fun onKeyDown(key: Int) {
        if (key == Global.KEY_UP) {
            if (--index < 0) {
                index = saveSlotCount - 1
            }
        } else if (key == Global.KEY_DOWN) {
            if (++index >= saveSlotCount) {
                index = 0
            }
        }
    }

    private fun exit() {
        (0 until popDepth).forEach {
            popScreen()
        }
        callback?.invoke()
    }

    override fun onKeyUp(key: Int) {
        if (key == Global.KEY_CANCEL) {
            popScreen()
            callback?.invoke()
        } else if (key == Global.KEY_ENTER) {
            val file = File("sav/" + mFileNames[index])
            if (mOperate == Operate.LOAD) { // 加载存档
                if (!file.exists()) {
                    return
                }
                if (!loadGame(file)) {
                    return
                }
                SaveLoadGame.startNewGame = false
                game.changeScreen(ScreenViewType.SCREEN_MAIN_GAME)
            } else { // 保存存档
                if (!file.exists()) {
                    file.createNewFile()
                    saveGame(file)
                    exit()
                } else { // 询问是否覆盖存档
                    pushScreen(ScreenMessageBox(this, "覆盖原进度?",
                            object : ScreenMessageBox.OnOKClickListener {
                                override fun onOKClick() {
                                    saveGame(file)
                                    exit()
                                }
                            }))
                }
            }
        }
    }

    private fun loadGame(file: File): Boolean {
        val ioIn = objectInputOf(file)
        if (!SaveLoadGame.read(game, ioIn))
            return false
        ScriptResources.read(ioIn)
        ioIn.close()
        return true
    }

    fun saveGame(file: File) {
        val o = objectOutputOf(file)
        SaveLoadGame.write(game, o)
        ScriptResources.write(o)
        o.close()
    }

}
