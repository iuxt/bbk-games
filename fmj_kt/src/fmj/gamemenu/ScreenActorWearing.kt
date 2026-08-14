package fmj.gamemenu

import fmj.Global
import fmj.characters.Player
import fmj.gamemenu.ScreenGoodsList.Mode
import fmj.goods.BaseGoods
import fmj.goods.GoodsEquipment
import fmj.graphics.TextRender
import fmj.graphics.Util
import fmj.views.BaseScreen
import fmj.views.GameNode

import graphics.Canvas
import graphics.Point
import graphics.Rect

import java.Stack
import java.gbkBytes

class ScreenActorWearing(override val parent: GameNode): BaseScreen {

    private val mPos: Array<Point>
    private var mEquipments: Array<GoodsEquipment?>
    private val mItemName = arrayOf("装饰", "装饰", "护腕", "脚蹬", "手持", "身穿", "肩披", "头戴")
    private var mCurItem = 0

    private var mActorIndex = -1

    private var showingDesc = false
    private val bmpName = Util.getFrameBitmap(92 - 9 + 1, 29 - 10 + 1)//Bitmap.createBitmap(92 - 9 + 1, 29 - 10 + 1, Config.ARGB_8888);
    private val bmpDesc = Util.getFrameBitmap(151 - 9 + 1, 65 - 28 + 1)//Bitmap.createBitmap(151 - 9 + 1, 65 - 28 + 1, Config.ARGB_8888);
    private var mTextName = byteArrayOf()
    private var mTextDesc = byteArrayOf()
    private var mToDraw = 0 // 当前要画的描述中的字节
    private var mNextToDraw = 0 // 下一个要画的描述中的字节
    private val mStackLastToDraw = Stack.create<Int>() // 保存上次描述所画位置

    init {
        mEquipments = game.playerList[0].equipmentsArray
        mActorIndex = 0
        // 还原 160×96 设备原生布局（上游曾按 320×192 重排，出屏）
        mPos = arrayOf(
            Point(4, 3),    // 装饰1
            Point(4, 30),   // 装饰2
            Point(21, 59),  // 护腕
            Point(51, 65),  // 脚蹬
            Point(80, 61),  // 手持
            Point(109, 46), // 身穿
            Point(107, 9),  // 肩披
            Point(79, 2)    // 头戴
        )
    }

    private fun getGBKBytes(s: String): ByteArray {
        return s.gbkBytes()
    }

    override fun update(delta: Long) {}

    override fun draw(canvas: Canvas) {
        canvas.drawColor(Global.COLOR_WHITE)
        // 穿戴底图贴右上角（老实现：160×96 下 x = 屏宽-图宽, y = 0）
        canvas.drawBitmap(Util.bmpChuandai, Global.SCREEN_WIDTH - Util.bmpChuandai.width, 0)

        // 画装备
        for (i in 0..7) {
            mEquipments[i]?.draw(canvas, mPos[i].x + 1, mPos[i].y + 1)
        }
        // 选框 25×25，与 24×24 的装备图标匹配（上游 320 版误放大为 32）
        canvas.drawRect(mPos[mCurItem].x, mPos[mCurItem].y,
                mPos[mCurItem].x + 25, mPos[mCurItem].y + 25, Util.sBlackPaint)
        TextRender.drawText(canvas, mItemName[mCurItem], 120, 80)

        // 画人物头像、姓名（还原 160×96 老坐标）
        if (mActorIndex >= 0) {
            val p = game.playerList[mActorIndex]
            p.drawHead(canvas, 44, 12)
            TextRender.drawText(canvas, p.name, 30, 40)
        }

        if (showingDesc) {
            // 还原老实现：名称框/说明框叠放在人像左侧，描述画进 sRectDesc
            canvas.drawBitmap(bmpName, 9, 10)
            canvas.drawBitmap(bmpDesc, 9, 28)
            TextRender.drawText(canvas, mTextName, 12, 13)
            mNextToDraw = TextRender.drawText(canvas, mTextDesc, mToDraw, sRectDesc)
        }
    }

    private fun resetDesc() {
        if (showingDesc) {
            showingDesc = false
            mNextToDraw = 0
            mToDraw = mNextToDraw
            mStackLastToDraw.clear()
        }
    }

    override fun onKeyDown(key: Int) {
        if (key == Global.KEY_DOWN && mCurItem < 8 - 1) {
            ++mCurItem
            resetDesc()
        } else if (key == Global.KEY_UP && mCurItem > 0) {
            --mCurItem
            resetDesc()
        } else if (key == Global.KEY_RIGHT && mActorIndex < game.playerList.size - 1) {
            ++mActorIndex
            mEquipments = game.playerList[mActorIndex].equipmentsArray
            resetDesc()
        } else if (key == Global.KEY_LEFT && mActorIndex > 0) {
            --mActorIndex
            mEquipments = game.playerList[mActorIndex].equipmentsArray
            resetDesc()
        } else if (showingDesc) {
            if (key == Global.KEY_PAGEDOWN) {
                if (mNextToDraw < mTextDesc.size) {
                    mStackLastToDraw.push(mToDraw)
                    mToDraw = mNextToDraw
                }
            } else if (key == Global.KEY_PAGEUP && mToDraw != 0) {
                mStackLastToDraw.pop()?.let {
                    mToDraw = it
                }
            }
        }
    }

    override fun onKeyUp(key: Int) {
        if (key == Global.KEY_CANCEL) {
            popScreen()
        } else if (key == Global.KEY_ENTER) {
            if (!showingDesc && mEquipments[mCurItem] != null) {
                showingDesc = true
                mTextName = getGBKBytes(mEquipments[mCurItem]?.name ?: "")
                mTextDesc = getGBKBytes(mEquipments[mCurItem]?.description ?: "")
            } else { // put change equipment screen
                resetDesc()
                pushScreen(ScreenGoodsList(this, getTheEquipList(Player.sEquipTypes[mCurItem]),
                        object : ScreenGoodsList.OnItemSelectedListener {
                            override fun onItemSelected(goods: BaseGoods, index: Int) {
                                val actor = game.playerList[mActorIndex]
                                // 装备列表是打开列表时的快照：确认时该装备可能已被
                                // deleteGoods 移出背包。校验背包确实持有、且未穿在
                                // 身上（装饰双槽），防止对已穿装备重复穿戴/装备复制
                                // （配合 ScreenChgEquipment 的失败回滚）。
                                if (Player.sGoodsList.getGoodsNum(goods.type, goods.index) < 1) {
                                    showMessage("没有该装备!", 1000L)
                                    return
                                }
                                if (actor.hasEquipt(goods.type, goods.index)) {
                                    showMessage("已装备!", 1000L)
                                    return
                                }
                                popScreen()
                                pushScreen(ScreenChgEquipment(this@ScreenActorWearing, actor, goods as GoodsEquipment, mCurItem))
                            }
                        }, Mode.Use))
            }
        }
    }

    private fun getTheEquipList(type: Int): List<BaseGoods> {
        val currentPlayer = game.playerList[mActorIndex]
        return Player.sGoodsList.equipList
                .filter { it.type == type && it.canPlayerUse(currentPlayer.index) }
    }

    companion object {
        private val sRectDesc = Rect(9 + 3, 28 + 3, 151, 65)
    }


}
