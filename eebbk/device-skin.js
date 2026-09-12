/* 朗文4980机身图坐标。图片是正视、透明背景的1184×1328 PNG，
   因此无需裁切或透视校正。rect 为键帽中心 x/y 与宽/高，
   单位均为原图像素。 */
(function(global) {
  'use strict';
  const photo = {
    src: 'assets/longman-4980.png?v=2',
    width: 1184, height: 1328,
    crop: { x: 0, y: 0, width: 1184, height: 1328 },
    lcd: { x: 109, y: 144, width: 731, height: 353 },
    screen: { x: 193, y: 150, width: 567, height: 342.3396226 },
  };
  const keys = [
    [0, '开关', 217, 793, 72, 54],
    [1, '目录', 324, 793, 72, 54],
    [2, '双解', 431, 793, 72, 54],
    [3, '十万', 538, 793, 72, 54],
    [4, '汉英', 645, 793, 72, 54],
    [5, '对话', 752, 793, 72, 54],
    [6, '下载', 859, 793, 72, 54],
    [7, '发音', 966, 793, 72, 54],
    [8, '1', 108, 879, 54, 52],
    [9, '2', 215, 879, 54, 52],
    [10, '3', 323, 879, 54, 52],
    [11, '4', 431, 879, 54, 52],
    [12, '5', 538, 879, 54, 52],
    [13, '6', 645, 879, 54, 52],
    [14, '7', 752, 879, 54, 52],
    [15, '8', 859, 879, 54, 52],
    [48, '9', 966, 879, 54, 52],
    [49, '0', 1074, 879, 54, 52],
    [16, 'Q', 107, 957, 70, 49],
    [17, 'W', 205, 957, 70, 49],
    [18, 'E', 303, 957, 70, 49],
    [19, 'R', 401, 957, 70, 49],
    [20, 'T', 499, 957, 70, 49],
    [21, 'Y', 597, 957, 70, 49],
    [22, 'U', 695, 957, 70, 49],
    [23, 'I', 793, 957, 70, 49],
    [50, 'O', 891, 957, 70, 49],
    [51, 'P', 989, 957, 70, 49],
    [54, '空格', 1086, 957, 68, 49],
    [24, 'A', 107, 1042, 70, 49],
    [25, 'S', 205, 1042, 70, 49],
    [26, 'D', 303, 1042, 70, 49],
    [27, 'F', 401, 1042, 70, 49],
    [28, 'G', 499, 1042, 70, 49],
    [29, 'H', 597, 1042, 70, 49],
    [30, 'J', 695, 1042, 70, 49],
    [31, 'K', 793, 1042, 70, 49],
    [52, 'L', 891, 1042, 70, 49],
    [53, '上', 967, 1052, 66, 66],
    [58, '上页', 1087, 1052, 66, 66],
    [32, '输入法', 107, 1125, 72, 50],
    [33, 'Z', 205, 1125, 70, 49],
    [34, 'X', 303, 1125, 70, 49],
    [35, 'C', 401, 1125, 70, 49],
    [36, 'V', 499, 1125, 70, 49],
    [37, 'B', 597, 1125, 70, 49],
    [38, 'N', 695, 1125, 70, 49],
    [39, 'M', 793, 1125, 70, 49],
    [55, '左', 898, 1122, 72, 62],
    [57, '右', 1028, 1122, 72, 62],
    [40, '中英符', 107, 1208, 72, 50],
    [41, '帮助', 205, 1208, 72, 50],
    [42, '查找', 303, 1208, 72, 50],
    [43, '插入', 401, 1208, 72, 50],
    [44, '修改', 499, 1208, 72, 50],
    [45, '删除', 597, 1208, 72, 50],
    [46, '跳出', 700, 1208, 84, 50],
    [47, '输入', 821, 1208, 158, 50],
    [56, '下', 967, 1195, 66, 66],
    [59, '下页', 1087, 1195, 66, 66],
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
    addButton('RESET 重启', [1073, 810, 22, 22], null, 'reset');
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
