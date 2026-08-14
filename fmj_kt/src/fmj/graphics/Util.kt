package fmj.graphics

import fmj.Global
import fmj.lib.DatLib
import fmj.lib.ResImage

import graphics.Bitmap
import graphics.Canvas
import graphics.Paint
import graphics.Paint.Style
import graphics.Rect
import java.gbkBytes

object Util {

    // 显示message的方框
    private var bmpInformationBg: Array<Bitmap>

    // 屏幕两边留白
    private var bmpSideFrame: Bitmap

    // 用于菜单的矩形框，黑框白边
    private var drawFramePaint = Paint()

    private var bmpTriangleCursor: Bitmap

    private var imgSmallNum: ResImage

    var bmpChuandai: Bitmap

    var sBlackPaint: Paint

    init {
        val canvas = Canvas()
        val paint = Paint()
        paint.color = Global.COLOR_WHITE
        paint.style = Style.FILL_AND_STROKE

        var ind = 0
        // 160×96 原生尺寸：框宽 138、内框右边 135、右上角标签 136..138
        // （上游 H5 改屏时曾放大到 240 宽，在 160 屏上画出界）
        bmpInformationBg = Array(5) {
            val bmp = Bitmap.createBitmap(138, 23 + 16 * ind)
            canvas.setBitmap(bmp)
            canvas.drawColor(Global.COLOR_BLACK)
            canvas.drawRect(1, 1, 135, 20 + 16 * ind, paint)
            canvas.drawRect(136, 0, 138, 3, paint)
            canvas.drawLine(0, 21 + 16 * ind, 3, 21 + 16 * ind, paint)
            canvas.drawLine(0, 22 + 16 * ind, 3, 22 + 16 * ind, paint)
            ind++
            bmp
        }

        bmpSideFrame = Bitmap.createBitmap(8, Global.SCREEN_HEIGHT)
        canvas.setBitmap(bmpSideFrame)
        canvas.drawColor(Global.COLOR_WHITE)
        paint.color = Global.COLOR_BLACK

        for (i in 0..3) {
            canvas.drawLine(i*2, 0, i*2, Global.SCREEN_HEIGHT, paint)
        }

        bmpTriangleCursor = Bitmap.createBitmap(7, 13)
        canvas.setBitmap(bmpTriangleCursor)
        canvas.drawColor(Global.COLOR_WHITE)
        for (i in 0..6) {
            canvas.drawLine(i, i, i, 13 - i, paint)
        }

        imgSmallNum = DatLib.getRes(DatLib.ResType.PIC, 2, 5) as ResImage

        bmpChuandai = Bitmap.createBitmap(22, 39)
        val b = Global.COLOR_BLACK
        val w = Global.COLOR_WHITE
        val pixels = arrayOf(w, w, w, w, w, w, w, w, w, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, b, b, w, w, b, b, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, b, b, b, b, b, w, w, w, w, w, w, w, w, b, b, b, b, b, w, w, w, w, b, b, w, w, w, b, b, b, w, w, b, b, b, w, w, w, b, b, w, w, w, w, w, b, w, w, b, w, w, w, w, w, w, w, w, w, w, w, b, b, w, w, w, w, w, b, w, w, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, b, w, w, w, w, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, w, w, b, b, w, w, w, b, b, b, b, w, b, b, b, b, b, b, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, w, w, w, b, b, b, w, w, w, w, w, w, w, b, b, b, b, w, w, b, b, b, w, w, w, w, w, w, w, b, b, b, b, b, b, b, b, w, w, w, w, b, b, b, w, w, w, w, w, w, w, w, b, b, b, b, w, w, w, w, w, w, w, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, b, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, b, w, w, w, w, b, b, w, w, w, b, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, w, b, b, w, w, b, b, w, w, w, w, w, w, w, b, b, w, w, b, w, w, w, w, b, b, w, b, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, b, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, w, b, b, w, b, b, w, w, w, w, w, w, w, w, w, b, b, w, b, b, b, b, w, b, b, w, b, b, w, w, w, w, w, w, w, w, w, b, w, b, b, w, w, b, w, w, b, w, b, b, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, w, w, b, b, b, b, w, w, w, w, w, w, w, w, w, b, b, b, b, b, b, b, w, w, b, b, b, w, w, w, w, w, w, w, w, w, w, w, b, b, b, b, b, w, w, w, w, b, b, b, w, w, w, w, w, w, b, b, b, b, b, w, w, w, w, b, b, b, b, b, b, b, b, b, b, w, w, w, w, w, w, b, b, b, w, w, b, b, w, b, b, w, w, b, b, b, b, b, b, b, w, w, b, b, w, w, w, w, w, w, b, w, w, w, w, w, b, b, b, b, b, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, w, b, b, w, w)
        bmpChuandai.setPixels(pixels, 0, 0, 0, 22, 39)
    }

    // 用于showscenename（160×96 设备原生布局）
    fun showInformation(canvas: Canvas, msg: String) {
        canvas.drawBitmap(bmpInformationBg[0], 11, 37)
        TextRender.drawText(canvas, msg, 16, 39)
    }

    // 显示message,每行最多显示8个汉字，最多可显示5行
    fun showMessage(canvas: Canvas, msg: String) {
        showMessage(canvas, msg.gbkBytes())
    }

    // 显示message（160×96 设备原生布局；上游 H5 改屏时曾按 320×192
    // 重排：240 宽的框在 160 屏幕上算出 -40 的起点，消息文字被画出屏幕）
    fun showMessage(canvas: Canvas, msg: ByteArray) {
        var lineNum = msg.size / 16
        if (lineNum >= 5) lineNum = 4
        val textY = 39 - lineNum * 8
        canvas.drawBitmap(bmpInformationBg[lineNum], 11, textY - 2)
        TextRender.drawText(canvas, msg, 0, Rect(16, textY, 144, textY + 16 * lineNum + 16))
    }

    fun drawSideFrame(canvas: Canvas) {
        canvas.drawBitmap(bmpSideFrame, 0, 0)
        canvas.drawBitmap(bmpSideFrame, Global.SCREEN_WIDTH - 8, 0)
    }

    init {
        drawFramePaint.color = Global.COLOR_BLACK
        drawFramePaint.style = Paint.Style.STROKE
    }

    fun getFrameBitmap(w: Int, h: Int): Bitmap {
        // 先创建Bitmap
        val bmp = Bitmap.createBitmap(w, h)
        val tmpC = Canvas(bmp)
        tmpC.drawColor(Global.COLOR_WHITE)
        tmpC.drawRect(1, 1, w - 2, h - 2, drawFramePaint)
        return bmp
    }

    fun drawTriangleCursor(canvas: Canvas, x: Int, y: Int) {
        canvas.drawBitmap(bmpTriangleCursor, x, y)
    }

    /**
     *
     * @return 画出的num宽度(像素)
     */
    fun drawSmallNum(canvas: Canvas, num: Int, x: Int, y: Int): Int {
        var tmpNum = num
        var tmpX = x
        if (tmpNum < 0) tmpNum = -tmpNum
        val digits = tmpNum.toString()

        for (i in digits.indices) {
            imgSmallNum.draw(canvas, digits[i] - '0' + 1, tmpX, y)
            tmpX += imgSmallNum.width + 1
        }

        return digits.length * imgSmallNum.width
    }

    fun getSmallSignedNumBitmap(num: Int): Bitmap {
        val digits = (if (num > 0) num else -num).toString()
        val sign = DatLib.getRes(DatLib.ResType.PIC, 2, if (num > 0) 6 else 7) as ResImage
        val bmp = Bitmap.createBitmap(
                sign.width + digits.length * imgSmallNum.width + 1 + digits.length,
                imgSmallNum.height)

        val c = Canvas(bmp)
        sign.draw(c, 1, 0, 0)

        var x = sign.width + 1
        for (i in digits.indices) {
            imgSmallNum.draw(c, digits[i] - '0' + 1, x, 0)
            x += imgSmallNum.width + 1
        }

        return bmp
    }

    init {
        sBlackPaint = Paint()
        sBlackPaint.color = Global.COLOR_BLACK
        sBlackPaint.style = Style.STROKE
        sBlackPaint.strokeWidth = 1
    }
}
