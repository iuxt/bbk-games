package fmj.lib

import graphics.Canvas

class ResSrs : ResBase() {
    /**
     * 帧数
     */
    private var mFrameNum: Int = 0

    /**
     * 图片数
     */
    private var mImageNum: Int = 0

    private var mStartFrame: Int = 0
    private var mEndFrame: Int = 0

    /**
     * `mFrameHeader = new int[mFrameNum][5];`
     *
     *
     * x,y,Show,nShow,imgIndex
     */
    private var mFrameHeader: Array<IntArray>? = null

    private var mImage: Array<ResImage>? = null

    private var ITERATOR = 1 // update 迭代次数
    private val mShowList = mutableListOf<Key>()

    /** 特效视觉锚点（各可见帧按面积加权的几何中心，由 BBKSrsAnchor 计算） */
    private var mImpactAnchorX = 0
    private var mImpactAnchorY = 0

    override fun setData(buf: ByteArray, offset: Int) {
        type = buf[offset].toInt()
        index = buf[offset + 1].toInt() and 0xFF
        mFrameNum = buf[offset + 2].toInt() and 0xFF
        mImageNum = buf[offset + 3].toInt() and 0xFF
        mStartFrame = buf[offset + 4].toInt() and 0xFF
        mEndFrame = buf[offset + 5].toInt() and 0xFF

        var ptr = offset + 6
        mFrameHeader = Array(mFrameNum) { IntArray(5) }
        for (i in 0 until mFrameNum) {
            mFrameHeader!![i][0] = buf[ptr++].toInt() and 0xFF // x
            mFrameHeader!![i][1] = buf[ptr++].toInt() and 0xFF // y
            mFrameHeader!![i][2] = buf[ptr++].toInt() and 0xFF // Show
            mFrameHeader!![i][3] = buf[ptr++].toInt() and 0xFF // nShow
            mFrameHeader!![i][4] = buf[ptr++].toInt() and 0xFF // 图号
        }

        // 读入mImageNum个ResImage
        mImage = Array(mImageNum) {
            val img = ResImage()
            img.setData(buf, ptr)
            ptr += img.bytesCount
            img
        }

        updateImpactAnchor()
    }

    private fun updateImpactAnchor() {
        val frameHeaders = mFrameHeader ?: return
        val images = mImage ?: return
        // 宿主页面提供的 srs-anchor.js；缺失（如测试沙箱）时退回首帧坐标，
        // drawAtTarget 退化为 drawAbsolutely 的语义。
        val anchor = js("typeof window.BBKSrsAnchor !== 'undefined'" +
                " ? window.BBKSrsAnchor.compute(frameHeaders, images) : null")
        if (anchor != null) {
            mImpactAnchorX = anchor.x
            mImpactAnchorY = anchor.y
        } else if (frameHeaders.isNotEmpty()) {
            mImpactAnchorX = frameHeaders[0][0]
            mImpactAnchorY = frameHeaders[0][1]
        }
    }

    private inner class Key(internal var index: Int) {
        internal var show: Int = 0
        internal var nshow: Int = 0

        init {
            val frameHeaders = mFrameHeader
            if (frameHeaders != null && index >= 0 && index < frameHeaders.size) {
                this.show = frameHeaders[index][2]
                this.nshow = frameHeaders[index][3]
            }
        }
    }

    /**
     * 开始特效动画
     */
    fun start() {
        if (mFrameNum == 0 || mFrameHeader == null || mImage == null) return
        mShowList.clear()
        mShowList.add(Key(0))
    }

    /**
     *
     * @return 返回false动画播放完毕
     */
    fun update(delta: Long): Boolean {
        if (mFrameNum == 0 || mFrameHeader == null || mImage == null) return false
        for (j in 0 until ITERATOR) {
            var iter: MutableListIterator<Key> = mShowList.listIterator()
            while (iter.hasNext()) {
                val i = iter.next()
                --i.show
                --i.nshow
                if (i.nshow == 0 && i.index + 1 < mFrameNum) {
                    iter.add(Key(i.index + 1)) // 下一帧开始显示
                }
            }
            iter = mShowList.listIterator()
            while (iter.hasNext()) {
                val i = iter.next()
                if (i.show <= 0) { // 该帧的图片显示完成
                    iter.remove()
                }
            }
            if (mShowList.isEmpty()) return false
        }
        return true
    }

    fun draw(canvas: Canvas, dx: Int, dy: Int) {
        val images = mImage ?: return
        val frameHeaders = mFrameHeader ?: return
        
        for (i in mShowList) {
            val frameIndex = i.index
            if (frameIndex >= 0 && frameIndex < frameHeaders.size) {
                val imageIndex = frameHeaders[frameIndex][4]
                if (imageIndex >= 0 && imageIndex < images.size) {
                    images[imageIndex].draw(canvas, 1, 
                        frameHeaders[frameIndex][0] + dx, 
                        frameHeaders[frameIndex][1] + dy)
                }
            }
        }
    }

    fun drawAbsolutely(canvas: Canvas, x: Int, y: Int) {
        val images = mImage ?: return
        val frameHeaders = mFrameHeader ?: return

        if (frameHeaders.isEmpty()) return

        for (i in mShowList) {
            val frameIndex = i.index
            if (frameIndex >= 0 && frameIndex < frameHeaders.size) {
                val imageIndex = frameHeaders[frameIndex][4]
                if (imageIndex >= 0 && imageIndex < images.size) {
                    images[imageIndex].draw(canvas, 1,
                        frameHeaders[frameIndex][0] - frameHeaders[0][0] + x,
                        frameHeaders[frameIndex][1] - frameHeaders[0][1] + y)
                }
            }
        }
    }

    /**
     * 以特效自身的视觉锚点（面积加权中心）为基准绘制到 (x, y)：
     * 多目标 SRS 的原始坐标是按满员编队制作的，直接按首帧偏移绘制会把
     * 特效落在玩家队伍上；先减去视觉锚点才能对准目标。
     */
    fun drawAtTarget(canvas: Canvas, x: Int, y: Int) {
        val images = mImage ?: return
        val frameHeaders = mFrameHeader ?: return

        for (i in mShowList) {
            val frameIndex = i.index
            if (frameIndex >= 0 && frameIndex < frameHeaders.size) {
                val imageIndex = frameHeaders[frameIndex][4]
                if (imageIndex >= 0 && imageIndex < images.size) {
                    images[imageIndex].draw(canvas, 1,
                        frameHeaders[frameIndex][0] - mImpactAnchorX + x,
                        frameHeaders[frameIndex][1] - mImpactAnchorY + y)
                }
            }
        }
    }

    /**
     * 同 drawAtTarget，但把各帧相对锚点的偏移按 (sx, sy) 比例压缩：
     * SRS 按 3 槽满员编队绘制，人数不足时按占用跨度比例缩放，使各列
     * 特效落在实际角色身上而不是空槽位。
     */
    private fun isThreeSlotGroupAnimation(frameHeaders: Array<IntArray>): Boolean {
        if (frameHeaders.size < 3 || frameHeaders.size % 3 != 0) return false

        for (group in frameHeaders.indices step 3) {
            val imageIndex = frameHeaders[group][4]
            val show = frameHeaders[group][2]
            val leftX = frameHeaders[group][0]
            val rightX = frameHeaders[group + 1][0]
            val middleX = frameHeaders[group + 2][0]

            if (frameHeaders[group + 1][4] != imageIndex ||
                frameHeaders[group + 2][4] != imageIndex ||
                frameHeaders[group + 1][2] != show ||
                frameHeaders[group + 2][2] != show ||
                middleX <= minOf(leftX, rightX) ||
                middleX >= maxOf(leftX, rightX)) {
                return false
            }
        }
        return true
    }

    fun drawAtTargetScaled(
        canvas: Canvas, x: Int, y: Int, sx: Double, sy: Double, targetCount: Int) {
        val images = mImage ?: return
        val frameHeaders = mFrameHeader ?: return
        val suppressEmptyMember = (targetCount == 1 || targetCount == 2) &&
            isThreeSlotGroupAnimation(frameHeaders)

        for (i in mShowList) {
            val frameIndex = i.index
            if (frameIndex >= 0 && frameIndex < frameHeaders.size) {
                // Three-slot group SRS files store simultaneous sprites as
                // [left, right, middle]. Scaling maps left/right onto the two
                // occupied slots, so the empty middle sprite must be skipped.
                if (suppressEmptyMember &&
                    ((targetCount == 2 && frameIndex % 3 == 2) ||
                        (targetCount == 1 && frameIndex % 3 != 0))) {
                    continue
                }
                val imageIndex = frameHeaders[frameIndex][4]
                if (imageIndex >= 0 && imageIndex < images.size) {
                    images[imageIndex].draw(canvas, 1,
                        ((frameHeaders[frameIndex][0] - mImpactAnchorX) * sx + x).toInt(),
                        ((frameHeaders[frameIndex][1] - mImpactAnchorY) * sy + y).toInt())
                }
            }
        }
    }

    fun setIteratorNum(n: Int) {
        ITERATOR = n
        if (ITERATOR < 1) {
            ITERATOR = 1
        }
    }

}
