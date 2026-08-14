package fmj.gamemenu

import fmj.Global
import fmj.characters.Player
import fmj.goods.BaseGoods
import fmj.graphics.TextRender
import fmj.graphics.Util
import fmj.views.BaseScreen
import fmj.views.GameNode

import graphics.Bitmap
import graphics.Canvas
import graphics.Rect

import java.Stack
import java.gbkBytes

class ScreenGoodsList(
        override val parent: GameNode,
        private val goodsList: List<BaseGoods>,
        private val itemSelectedListener: OnItemSelectedListener,
        private val mode: Mode,
        initialCursorIndex: Int = 0): BaseScreen {

    private var description = "".gbkBytes()

    private var toDraw = 0 // 当前要画的描述中的字节
    private var nextToDraw = 0 // 下一个要画的描述中的字节
    private val stackLastToDraw = Stack.create<Int>() // 保存上次描述所画位置

    private var firstDisplayItemIndex = 0 // 界面上显示的第一个物品的序号

    private var curItemIndex = initialCursorIndex // 当前光标所在位置物品的序号，使用传入的初始位置
    private var lastDownKey = -1

    enum class Mode {
        Sale,
        Buy,
        Use
    }

    interface OnItemSelectedListener {
        fun onItemSelected(goods: BaseGoods, index: Int = 0)
    }

    private fun resetDescription() {
        description = if (goodsList.isNotEmpty()) {
            // 老实现直接显示描述原文，无 "说明:" 前缀（160×96 下前缀会挤占两行描述区）
            goodsList[curItemIndex].description.gbkBytes()
        } else {
            "".gbkBytes()
        }
        nextToDraw = 0
        toDraw = nextToDraw
        stackLastToDraw.clear()
    }

    override fun willAppear() {
        if (goodsList.isEmpty()) {
            curItemIndex = 0
        } else if (curItemIndex >= goodsList.size) {
            curItemIndex = goodsList.size - 1
        }
        
        // 计算合适的 firstDisplayItemIndex，确保当前项可见
        if (curItemIndex >= itemNumberPerPage) {
            firstDisplayItemIndex = curItemIndex - itemNumberPerPage + 1
            if (firstDisplayItemIndex < 0) {
                firstDisplayItemIndex = 0
            }
        }
        
        resetDescription()
    }

    override fun update(delta: Long) {
        if (goodsList.isEmpty()) {
            popScreen()
        }
    }

    override fun draw(canvas: Canvas) {
        // 还原 160×96 老布局：底图全屏，左侧 4 行物品列表（行距 23），右侧信息/描述
        canvas.drawBitmap(bgImage, 0, 0)
        if (goodsList.isEmpty()) return

        while (curItemIndex >= goodsList.size) showPreItem()

        val g = goodsList[curItemIndex]

        TextRender.drawText(canvas, if (mode == Mode.Buy) "金钱:" + Player.sMoney else "数量:" + g.goodsNum, 60, 2)
        TextRender.drawText(canvas, g.name, 69, 23)
        TextRender.drawText(canvas, "" + if (mode == Mode.Buy) g.buyPrice else g.sellPrice, 69, 40)

        Util.drawTriangleCursor(canvas, 4, 8 + 23 * (curItemIndex - firstDisplayItemIndex))

        var i = firstDisplayItemIndex
        while (i < firstDisplayItemIndex + itemNumberPerPage && i < goodsList.size) {
            goodsList[i].draw(canvas, 14, 2 + 23 * (i - firstDisplayItemIndex))
            i++
        }

        nextToDraw = TextRender.drawText(canvas, description, toDraw, displayRect)
    }

    private fun showNextItem() {
        ++curItemIndex
        if (curItemIndex >= firstDisplayItemIndex + itemNumberPerPage) {
            ++firstDisplayItemIndex
        }
        resetDescription()
    }

    private fun showPreItem() {
        --curItemIndex
        if (curItemIndex < firstDisplayItemIndex) {
            --firstDisplayItemIndex
        }
        resetDescription()
    }

    override fun onKeyDown(key: Int) {
        if (key == Global.KEY_UP && curItemIndex > 0) {
            showPreItem()
        } else if (key == Global.KEY_DOWN && curItemIndex + 1 < goodsList.size) {
            showNextItem()
        } else if (key == Global.KEY_PAGEDOWN) {
            val len = description.size
            if (nextToDraw < len) {
                stackLastToDraw.push(toDraw)
                toDraw = nextToDraw
            }
        } else if (key == Global.KEY_PAGEUP && toDraw != 0) {
            stackLastToDraw.pop()?.let {
                toDraw = it
            }
        }
        lastDownKey = key
    }

    override fun onKeyUp(key: Int) {
        if (key == Global.KEY_ENTER && lastDownKey == Global.KEY_ENTER) {
            itemSelectedListener.onItemSelected(goodsList[curItemIndex], curItemIndex)
        } else if (key == Global.KEY_CANCEL) {
            popScreen()
        }
    }

    companion object {

        // 还原 160×96 老实现的底图：全屏 160×96 线框（左侧物品栏 + 右侧名/价/描述栏）
        private val bgImage by lazy {
            val bmp = Bitmap.createBitmap(160, 96)
            // 老实现的线段表；两端超界的 160/96 端点（JS 版越界写不生效）收敛到 159/95
            val pts = floatArrayOf(
                40f, 21f, 40f, 95f, 40f, 95f, 0f, 95f, 0f, 95f, 0f, 5f, 0f, 5f, 5f, 0f,
                5f, 0f, 39f, 0f, 39f, 0f, 58f, 19f, 38f, 0f, 57f, 19f, 57f, 19f, 140f, 19f,
                41f, 20f, 140f, 20f, 41f, 21f, 159f, 21f, 54f, 0f, 140f, 0f, 40f, 95f, 159f, 95f,
                40f, 57f, 159f, 57f, 40f, 58f, 140f, 58f, 40f, 59f, 159f, 59f, 41f, 20f, 41f, 95f,
                42f, 20f, 42f, 95f, 159f, 21f, 159f, 57f, 159f, 59f, 159f, 95f)
            val c = Canvas(bmp)
            c.drawColor(Global.COLOR_WHITE)
            c.drawLines(pts, Util.sBlackPaint)
            TextRender.drawText(c, "名:", 45, 23)
            TextRender.drawText(c, "价:", 45, 40)
            bmp
        }

        // 描述区域（160×96 老值）
        private val displayRect = Rect(44, 61, 156, 94)

        private val itemNumberPerPage = 4 // 界面上显示的条目数（老值 4，行距 23）
    }
}
