/* 朗文4988拟真机身图坐标。图片为正交俯拍的 1254×1254 PNG，
   保留完整画布；rect 为键帽中心 x/y 与热区宽/高，单位均为原图像素。
   4988 的数字键兼作词典功能键，目录/双解/现汉/Shift 则是键盘下方的
   四枚独立按键，因此不能沿用旧 4980 机身图的 60 键坐标。 */
(function(global) {
  'use strict';
  const photo = {
    src: 'assets/bbk-electronic-dictionary-photorealistic.png?v=2',
    width: 1254, height: 1254,
    crop: { x: 0, y: 0, width: 1254, height: 1254 },
    lcd: { x: 261, y: 126, width: 734, height: 345 },
    screen: { x: 360, y: 138, width: 530, height: 320 },
  };
  const keys = [
    [0, '开关', 205, 724, 54, 54],
    [8, '1 释义', 292, 725, 70, 38],
    [9, '2 例句', 377, 725, 70, 38],
    [10, '3 例证', 461, 725, 70, 38],
    [11, '4 习语', 545, 725, 70, 38],
    [12, '5 同反', 628, 725, 70, 38],
    [13, '6 用法', 711, 725, 70, 38],
    [14, '7 语速', 794, 725, 70, 38],
    [15, '8 反查', 878, 725, 70, 38],
    [48, '9 复读', 962, 725, 70, 38],
    [49, '0 发音', 1046, 725, 70, 38],
    [16, 'Q', 204, 786, 72, 54],
    [17, 'W', 293, 786, 72, 54],
    [18, 'E', 385, 786, 72, 54],
    [19, 'R', 477, 786, 72, 54],
    [20, 'T', 573, 786, 72, 54],
    [21, 'Y', 667, 786, 72, 54],
    [22, 'U', 760, 786, 72, 54],
    [23, 'I', 852, 786, 72, 54],
    [50, 'O', 946, 786, 72, 54],
    [51, 'P', 1043, 786, 72, 54],
    [24, 'A', 247, 850, 72, 54],
    [25, 'S', 340, 850, 72, 54],
    [26, 'D', 434, 850, 72, 54],
    [27, 'F', 528, 850, 72, 54],
    [28, 'G', 622, 850, 72, 54],
    [29, 'H', 716, 850, 72, 54],
    [30, 'J', 810, 850, 72, 54],
    [31, 'K', 904, 850, 72, 54],
    [52, 'L', 998, 850, 72, 54],
    [33, 'Z', 199, 918, 72, 54],
    [34, 'X', 292, 918, 72, 54],
    [35, 'C', 385, 918, 72, 54],
    [36, 'V', 479, 918, 72, 54],
    [37, 'B', 573, 918, 72, 54],
    [38, 'N', 670, 918, 72, 54],
    [39, 'M', 766, 918, 72, 54],
    [54, '空格', 861, 918, 76, 54],
    [32, '输入法', 958, 918, 76, 54],
    [40, '中英符', 1053, 918, 76, 54],
    [1, '目录', 442, 989, 108, 34],
    [2, '双解', 563, 989, 108, 34],
    [3, '现汉', 684, 989, 108, 34],
    [45, 'Shift', 805, 989, 108, 34],
    [46, 'Exit 跳出', 519, 1066, 66, 66],
    [47, 'Enter 输入', 663, 1072, 84, 84],
    [53, '上，Shift 加上为修改', 883, 1058, 58, 48],
    [55, '左，Shift 加左为删除', 824, 1100, 56, 50],
    [57, '右，Shift 加右为插入', 943, 1100, 56, 50],
    [56, '下，Shift 加下为查找', 883, 1142, 58, 48],
    [58, '上页', 1049, 1066, 62, 62],
    [59, '下页', 1049, 1136, 62, 62],
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
    addButton('RESET 重启', [971, 994, 28, 28], null, 'reset');
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
