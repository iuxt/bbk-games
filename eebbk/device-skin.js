/* 朗文4988拟真机身图坐标。图片为正交俯拍的 1254×1254 PNG，
   保留完整画布；rect 为键帽中心 x/y 与热区宽/高，单位均为原图像素。
   4988 的数字键兼作词典功能键，目录/双解/现汉/Shift 则是键盘下方的
   四枚独立按键，因此不能沿用旧 4980 机身图的 60 键坐标。 */
(function(global) {
  'use strict';
  const photo = {
    src: 'assets/bbk-electronic-dictionary-photorealistic.png?v=3',
    width: 1254, height: 1254,
    crop: { x: 0, y: 0, width: 1254, height: 1254 },
    lcd: { x: 254, y: 128, width: 748, height: 340 },
    screen: { x: 357, y: 134, width: 543.25, height: 328 },
  };
  const keys = [
    [0, '开关', 197, 722, 54, 54],
    [8, '1 释义', 289, 724, 74, 36],
    [9, '2 例句', 375, 724, 74, 36],
    [10, '3 例证', 461, 724, 74, 36],
    [11, '4 习语', 546, 724, 74, 36],
    [12, '5 同反', 631, 724, 74, 36],
    [13, '6 用法', 715, 724, 74, 36],
    [14, '7 语速', 801, 724, 74, 36],
    [15, '8 反查', 885, 724, 74, 36],
    [48, '9 复读', 970, 724, 74, 36],
    [49, '0 发音', 1054, 724, 74, 36],
    [16, 'Q', 198, 782, 78, 52],
    [17, 'W', 291, 782, 78, 52],
    [18, 'E', 387, 782, 78, 52],
    [19, 'R', 481, 782, 78, 52],
    [20, 'T', 576, 782, 78, 52],
    [21, 'Y', 672, 782, 78, 52],
    [22, 'U', 767, 782, 78, 52],
    [23, 'I', 861, 782, 78, 52],
    [50, 'O', 956, 782, 78, 52],
    [51, 'P', 1050, 782, 78, 52],
    [24, 'A', 244, 846, 78, 52],
    [25, 'S', 339, 846, 78, 52],
    [26, 'D', 434, 846, 78, 52],
    [27, 'F', 530, 846, 78, 52],
    [28, 'G', 625, 846, 78, 52],
    [29, 'H', 721, 846, 78, 52],
    [30, 'J', 817, 846, 78, 52],
    [31, 'K', 912, 846, 78, 52],
    [52, 'L', 1008, 846, 78, 52],
    [33, 'Z', 193, 909, 80, 54],
    [34, 'X', 288, 909, 80, 54],
    [35, 'C', 383, 909, 80, 54],
    [36, 'V', 480, 909, 80, 54],
    [37, 'B', 576, 909, 80, 54],
    [38, 'N', 673, 909, 80, 54],
    [39, 'M', 771, 909, 80, 54],
    [54, '空格', 867, 909, 80, 54],
    [32, '输入法', 964, 909, 80, 54],
    [40, '中英符', 1060, 909, 80, 54],
    [1, '目录', 436, 978, 108, 32],
    [2, '双解', 560, 978, 108, 32],
    [3, '现汉', 686, 978, 108, 32],
    [45, 'Shift', 809, 978, 108, 32],
    [46, 'Exit 跳出', 516, 1050, 66, 66],
    [47, 'Enter 输入', 655, 1072, 108, 108],
    [53, '上，Shift 加上为修改', 883, 1043, 60, 48],
    [55, '左，Shift 加左为删除', 821, 1082, 58, 52],
    [57, '右，Shift 加右为插入', 945, 1082, 58, 52],
    [56, '下，Shift 加下为查找', 883, 1123, 60, 48],
    [58, '上页', 1056, 1046, 58, 68],
    [59, '下页', 1056, 1118, 58, 68],
  ].map(function(row) {
    return { code: row[0], label: row[1], rect: row.slice(2) };
  });

  function position(rect) {
    return {
      left: rect[0] - rect[2] / 2 - photo.crop.x,
      top: rect[1] - rect[3] / 2 - photo.crop.y,
      width: rect[2], height: rect[3],
    };
  }

  function mount(host) {
    const doc = host.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'device-photo-layer';
    const img = doc.createElement('img');
    img.className = 'device-photo';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    layer.appendChild(img);
    const controls = doc.createElement('div');
    controls.className = 'device-hotspots';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '朗文4988原机键盘');
    function addButton(label, rect, code, action) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'device-key';
      button.setAttribute('aria-label', label);
      if (code !== null) button.dataset.key = String(code);
      if (action) button.dataset.deviceAction = action;
      const bounds = position(rect);
      Object.keys(bounds).forEach(function(name) { button.style[name] = bounds[name] + 'px'; });
      controls.appendChild(button);
    }
    keys.forEach(function(key) {
      addButton(key.label, key.rect, key.code, key.code === 0 ? 'power' : '');
    });
    addButton('RESET 重启', [979, 987, 28, 28], null, 'reset');
    layer.appendChild(controls);
    host.appendChild(layer);
    function resize() {
      const width = host.getBoundingClientRect().width;
      if (width > 0) layer.style.transform = 'scale(' + width / photo.crop.width + ')';
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return {
      layer: layer,
      show: function() {
        if (!img.getAttribute('src')) img.src = photo.src;
        resize();
      },
    };
  }
  global.BBK4988Skin = { photo: photo, keys: keys, position: position, mount: mount };
}(typeof window !== 'undefined' ? window : globalThis));
