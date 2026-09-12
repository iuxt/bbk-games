/* 朗文4980机身图坐标。图片为透明背景的1254×1254 PNG，
   保留完整画布，逐键标定以适应照片中的倾斜。rect 为键帽中心 x/y 与宽/高，
   单位均为原图像素。 */
(function(global) {
  'use strict';
  const photo = {
    src: 'assets/longman-4980-transparent.png?v=1',
    width: 1254, height: 1254,
    crop: { x: 0, y: 0, width: 1254, height: 1254 },
    lcd: { x: 215, y: 155, width: 668, height: 325 },
    screen: { x: 291, y: 162, width: 516, height: 311.5471698 },
  };
  const keys = [
    [0, '开关', 316, 756, 68, 48],
    [1, '目录', 414, 755, 68, 48],
    [2, '双解', 511, 754, 68, 48],
    [3, '十万', 607, 753, 68, 48],
    [4, '汉英', 703, 752, 68, 48],
    [5, '对话', 800, 752, 68, 48],
    [6, '下载', 898, 751, 68, 48],
    [7, '发音', 996, 750, 68, 48],
    [8, '1', 217, 834, 52, 52],
    [9, '2', 315, 833, 52, 52],
    [10, '3', 413, 831, 52, 52],
    [11, '4', 510, 830, 52, 52],
    [12, '5', 607, 828, 52, 52],
    [13, '6', 704, 827, 52, 52],
    [14, '7', 801, 826, 52, 52],
    [15, '8', 898, 825, 52, 52],
    [48, '9', 995, 824, 52, 52],
    [49, '0', 1093, 824, 52, 52],
    [16, 'Q', 216, 905, 68, 50],
    [17, 'W', 305, 903, 68, 50],
    [18, 'E', 394, 901, 68, 50],
    [19, 'R', 481, 900, 68, 50],
    [20, 'T', 569, 899, 68, 50],
    [21, 'Y', 656, 897, 68, 50],
    [22, 'U', 744, 896, 68, 50],
    [23, 'I', 831, 896, 68, 50],
    [50, 'O', 918, 895, 68, 50],
    [51, 'P', 1007, 894, 68, 50],
    [54, '空格', 1095, 893, 68, 50],
    [24, 'A', 216, 982, 68, 50],
    [25, 'S', 304, 980, 68, 50],
    [26, 'D', 390, 978, 68, 50],
    [27, 'F', 476, 977, 68, 50],
    [28, 'G', 563, 975, 68, 50],
    [29, 'H', 648, 975, 68, 50],
    [30, 'J', 733, 973, 68, 50],
    [31, 'K', 817, 972, 68, 50],
    [52, 'L', 902, 972, 68, 50],
    [53, '上', 994, 979, 60, 70],
    [58, '上页', 1102, 977, 60, 70],
    [32, '输入法', 216, 1058, 68, 50],
    [33, 'Z', 307, 1057, 68, 50],
    [34, 'X', 397, 1054, 68, 50],
    [35, 'C', 486, 1053, 68, 50],
    [36, 'V', 576, 1052, 68, 50],
    [37, 'B', 665, 1051, 68, 50],
    [38, 'N', 754, 1049, 68, 50],
    [39, 'M', 843, 1048, 68, 50],
    [55, '左', 935, 1047, 72, 58],
    [57, '右', 1051, 1044, 72, 58],
    [40, '中英符', 216, 1134, 68, 50],
    [41, '帮助', 305, 1132, 68, 50],
    [42, '查找', 392, 1131, 68, 50],
    [43, '插入', 477, 1129, 68, 50],
    [44, '修改', 563, 1128, 68, 50],
    [45, '删除', 649, 1127, 68, 50],
    [46, '跳出', 749, 1125, 84, 50],
    [47, '输入', 866, 1123, 146, 52],
    [56, '下', 995, 1111, 60, 70],
    [59, '下页', 1102, 1108, 60, 70],
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
    controls.setAttribute('aria-label', '朗文4980原机键盘');
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
    addButton('RESET 重启', [1092, 765, 22, 22], null, 'reset');
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
  global.BBK4980Skin = { photo: photo, keys: keys, position: position, mount: mount };
}(typeof window !== 'undefined' ? window : globalThis));
