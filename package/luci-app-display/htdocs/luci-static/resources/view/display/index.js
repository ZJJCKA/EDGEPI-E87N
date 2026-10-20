'use strict';
'require dom';
'require fs';
'require uci';
'require ui';
'require view';

var HELPER = '/usr/sbin/display-control';
var FRAME_SNAPSHOT = '/tmp/display-framebuffer.raw';
var FRAME_REFRESH_MS = 100;

var SCREENS = [
	{ id: 1, title: _('屏幕 1 - 网络状态界面') },
	{ id: 2, title: _('屏幕 2 - 时间时钟界面') },
	{ id: 3, title: _('屏幕 3 - 流量统计界面') },
	{ id: 4, title: _('屏幕 4 - 硬件监控界面') }
];

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.exec(HELPER, [ 'status' ]), {}),
			uci.load('display')
		]);
	},

	addStyle: function() {
		if (document.getElementById('display-control-style'))
			return;

		document.head.appendChild(E('link', {
			id: 'display-control-style',
			rel: 'stylesheet',
			href: L.resource('view/display/index.css') + '?v=22'
		}));
	},

	icon: function(name) {
		var icons = {
			sun: {
				viewBox: '0 0 1024 1024',
				body: '<path d="M457.475135 976.622041l-0.511799-7.311413V950.885866a54.908714 54.908714 0 0 1 109.232516-7.311413l0.438684 7.311413v18.278534a54.8356 54.8356 0 0 1-109.159401 7.311413z m-307.591161-102.359787a54.8356 54.8356 0 0 1-5.337332-71.432509l5.337332-6.141587 12.868088-12.868087a54.8356 54.8356 0 0 1 82.911427 71.432508l-5.337331 6.141588-12.868088 12.868087a54.8356 54.8356 0 0 1-77.574096 0z m652.397415 5.337332l-6.141587-5.337332-12.868087-12.868087a54.8356 54.8356 0 0 1 71.432508-82.838314l6.141588 5.337332 12.868087 12.868087a54.8356 54.8356 0 0 1-71.432509 82.838314zM182.785334 512.201064A329.013602 329.013602 0 1 1 511.798936 841.214666 329.379172 329.379172 0 0 1 182.785334 512.201064z m73.114134 0A255.899468 255.899468 0 1 0 511.798936 256.301596 255.899468 255.899468 0 0 0 255.899468 512.201064z m73.114134 0A182.785334 182.785334 0 0 1 511.798936 329.41573v365.570668A182.785334 182.785334 0 0 1 329.013602 512.201064z m621.470137 54.8356a54.8356 54.8356 0 0 1-7.311414-109.159401l7.311414-0.511799h18.278533a54.8356 54.8356 0 0 1 7.311413 109.232515l-7.311413 0.438685z m-895.648139 0a54.8356 54.8356 0 0 1-7.311413-109.159401l7.311413-0.511799H73.114134a54.908714 54.908714 0 0 1 7.311413 109.232515L73.114134 567.036664z m728.436115-326.235265a54.8356 54.8356 0 0 1-5.337332-71.432508l5.337332-6.214702 12.868087-12.868087a54.8356 54.8356 0 0 1 82.838314 71.432509l-5.337332 6.214701-12.868088 12.868087a54.8356 54.8356 0 0 1-77.500981 0z m-620.446539 0l-12.941202-12.941201A54.8356 54.8356 0 0 1 227.45807 150.286102l12.868088 12.868087a54.8356 54.8356 0 0 1-77.500982 77.64721zM457.475135 80.827675L456.963336 73.516261V55.237728a54.908714 54.908714 0 0 1 109.232516-7.311413l0.438684 7.311413V73.516261a54.8356 54.8356 0 0 1-109.159401 7.311414z"></path>'
			},
			clock: {
				viewBox: '0 0 1025 1024',
				body: '<path d="M874.291209 149.9136C777.540276 53.256533 648.960009 0 512.119476 0 375.321609 0 246.724276 53.256533 150.016009 149.930667 53.273609 246.6304 9.0e-06 375.227733 9.0e-06 512c-0.0256 136.797867 53.205333 265.352533 149.9392 362.120533C246.630409 970.734933 375.244809 1024 512.025609 1024c136.840533 0 265.4976-53.2992 362.2656-149.981867C1073.928543 674.414933 1073.962676 349.602133 874.291209 149.9136L874.291209 149.9136 874.291209 149.9136zM827.093343 826.8288c-84.155733 84.1216-196.0448 130.491733-315.067733 130.491733-118.9376 0-230.801067-46.353067-314.9056-130.389333C113.024009 742.8352 66.713609 630.9888 66.739209 512c0-118.971733 46.327467-230.826667 130.449067-314.897067C281.309876 113.024 393.139209 66.730667 512.119476 66.730667c118.9888 0 230.8352 46.293333 314.973867 130.3808C1000.729609 370.7392 1000.729609 653.2608 827.093343 826.8288L827.093343 826.8288 827.093343 826.8288zM733.422943 637.474133 556.390409 535.125333 556.390409 256c0-23.552-19.114667-42.666667-42.683733-42.666667-23.552 0-42.666667 19.106133-42.666667 42.666667l0 298.6752c0 15.829333 19.677867 29.098667 32.477867 36.437333 3.541333 5.3248 13.269333 10.154667 19.208533 13.568l176.0512 106.6752c20.394667 11.767467 42.504533 4.770133 54.280533-15.616C764.834143 675.328 753.868809 649.258667 733.422943 637.474133L733.422943 637.474133 733.422943 637.474133zM733.422943 637.474133"></path>'
			},
			screen: {
				viewBox: '0 0 24 24',
				stroke: true,
				body: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'
			},
			save: {
				viewBox: '0 0 1024 1024',
				body: '<path d="M870.4 0H153.6A153.6 153.6 0 0 0 0 153.6v716.8A153.984 153.984 0 0 0 153.6 1024h716.8A153.984 153.984 0 0 0 1024 870.4V153.6A153.6 153.6 0 0 0 870.4 0z m-96.32 71.296V432H249.984V71.296H774.08zM952.704 870.4a82.112 82.112 0 0 1-82.304 81.92H153.6a82.112 82.112 0 0 1-82.304-81.92V153.6c0-45.44 36.864-82.24 82.304-82.304h24.96V467.84a35.456 35.456 0 0 0 35.648 35.456h595.456a35.456 35.456 0 0 0 35.712-35.456V71.296H870.4c45.44 0 82.24 36.864 82.304 82.304v716.8zM649.6 355.456a35.84 35.84 0 0 0 35.648-35.84V172.608a35.712 35.712 0 0 0-71.36 0v147.008a35.84 35.84 0 0 0 35.584 35.84h0.128zM256 658.304h512a36.544 36.544 0 0 1 0 73.152H256a36.544 36.544 0 0 1 0-73.152z"></path>'
			},
			reset: {
				viewBox: '0 0 1024 1024',
				body: '<path d="M911.40249 607.60166c-21.244813-4.248963-46.738589 8.497925-50.987552 29.742738-42.489627 174.207469-195.452282 293.178423-373.908714 293.178424-212.448133 0-386.655602-174.207469-386.655602-386.655602s174.207469-386.655602 386.655602-386.655602c97.726141 0 195.452282 38.240664 263.435685 106.224067h-178.456432c-21.244813 0-42.489627 16.995851-42.489626 42.489626 0 21.244813 16.995851 42.489627 42.489626 42.489627h263.435685c21.244813 0 42.489627-16.995851 42.489626-42.489627v-263.435684c0-21.244813-16.995851-42.489627-42.489626-42.489627-21.244813 0-42.489627 16.995851-42.489627 42.489627v148.713693c-84.979253-76.481328-195.452282-118.970954-310.174274-118.970955-259.186722 0-471.634855 212.448133-471.634854 471.634855s212.448133 471.634855 471.634854 471.634855c216.697095 0 403.651452-148.713693 458.887967-356.912863 4.248963-21.244813-8.497925-42.489627-29.742738-50.987552z"></path>'
			}
		};
		var icon = icons[name] || icons.screen;
		var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		var parsed = new DOMParser().parseFromString(
			'<svg xmlns="http://www.w3.org/2000/svg">' + icon.body + '</svg>',
			'image/svg+xml'
		).documentElement;

		svg.setAttribute('viewBox', icon.viewBox);

		if (icon.stroke) {
			svg.setAttribute('fill', 'none');
			svg.setAttribute('stroke', 'currentColor');
			svg.setAttribute('stroke-width', '2');
			svg.setAttribute('stroke-linecap', 'round');
			svg.setAttribute('stroke-linejoin', 'round');
		} else {
			svg.setAttribute('fill', 'currentColor');
		}

		Array.prototype.slice.call(parsed.childNodes).forEach(function(child) {
			svg.appendChild(document.importNode(child, true));
		});

		return E('span', { class: 'display-icon', 'aria-hidden': 'true' }, [
			svg
		]);
	},

	screenImage: function(id) {
		return L.resource('display/screen' + id + '.png');
	},

	readFramebuffer: function() {
		/* Capture fb0 into an atomic regular file first. cgi-download cannot
		 * reliably infer the size of a character device, which left the UI on its
		 * static fallback until F5. The helper writes only to /tmp (RAM). */
		return fs.exec_direct(HELPER, [ 'frame-snapshot' ], 'json').then(function(result) {
			if (!result || result.ok !== true || result.path !== FRAME_SNAPSHOT)
				throw new Error(_('Unexpected framebuffer snapshot path'));

			return fs.read_direct(FRAME_SNAPSHOT, 'blob');
		}).then(function(blob) {
			return blob.arrayBuffer();
		});
	},

	paintFramebuffer: function(canvas) {
		var info = this.frameInfo || {};
		var buffer = this.frameBuffer;
		var width = this.clamp(info.width || 428, 1, 4096);
		var height = this.clamp(info.height || 142, 1, 4096);
		var bpp = this.clamp(info.bpp || 16, 1, 64);
		var bytesPerPixel = Math.ceil(bpp / 8);
		var stride = this.clamp(info.stride || width * bytesPerPixel, width * bytesPerPixel, 1048576);
		var bytes, source, sourceContext, image, out, x, y, offset, value;
		var targetContext;

		if (!canvas || !(buffer instanceof ArrayBuffer))
			return false;

		if (bpp !== 16 && bpp !== 24 && bpp !== 32)
			return false;

		bytes = new Uint8Array(buffer);
		if (bytes.byteLength < stride * height)
			return false;

		source = document.createElement('canvas');
		source.width = width;
		source.height = height;
		sourceContext = source.getContext('2d');
		image = sourceContext.createImageData(width, height);
		out = image.data;

		for (y = 0; y < height; y++) {
			for (x = 0; x < width; x++) {
				offset = y * stride + x * bytesPerPixel;
				value = (y * width + x) * 4;

				if (bpp === 16) {
					var rgb565 = bytes[offset] | (bytes[offset + 1] << 8);
					out[value] = Math.round(((rgb565 >> 11) & 0x1f) * 255 / 31);
					out[value + 1] = Math.round(((rgb565 >> 5) & 0x3f) * 255 / 63);
					out[value + 2] = Math.round((rgb565 & 0x1f) * 255 / 31);
				} else {
					/* Linux framebuffer 24/32-bit layouts on this target are BGR(A). */
					out[value] = bytes[offset + 2];
					out[value + 1] = bytes[offset + 1];
					out[value + 2] = bytes[offset];
				}

				out[value + 3] = 255;
			}
		}

		sourceContext.putImageData(image, 0, 0);
		targetContext = canvas.getContext('2d');
		targetContext.clearRect(0, 0, canvas.width, canvas.height);
		targetContext.imageSmoothingEnabled = false;
		targetContext.drawImage(source, 0, 0, canvas.width, canvas.height);
		return true;
	},

	renderPreviewVisual: function() {
		var canvas;

		if (this.state && this.state.enabled && this.frameBuffer) {
			canvas = E('canvas', {
				class: 'display-live-frame',
				width: '428',
				height: '142',
				'aria-label': _('当前屏幕实时预览')
			});

			if (this.paintFramebuffer(canvas))
				return canvas;
		}

		return E('img', { src: this.previewImage(), alt: _('当前屏幕预览') });
	},

	updateLivePreviewDom: function() {
		var frame = document.querySelector('.display-preview-frame');
		var canvas = frame ? frame.querySelector('canvas.display-live-frame') : null;

		if (!frame)
			return;

		if (!(this.state.enabled && canvas && this.paintFramebuffer(canvas)))
			dom.content(frame, [ this.renderPreviewVisual() ]);
	},

	captureFramebuffer: function() {
		var self = this;
		var generation = this.frameGeneration || 0;

		if (this.frameCaptureBusy || this.frameSyncPaused || !this.state || !this.state.enabled)
			return Promise.resolve();

		this.frameCaptureBusy = true;
		return this.readFramebuffer().then(function(buffer) {
			self.frameCaptureBusy = false;
			if (self.frameSyncPaused || generation !== (self.frameGeneration || 0))
				return;

			self.frameBuffer = buffer;
			self.updateLivePreviewDom();
		}, function() {
			/* Keep the static selected-screen fallback if fb0 is unavailable. */
			self.frameCaptureBusy = false;
		});
	},

	stopFramebufferSync: function(removeVisibilityHandler) {
		if (this.frameTimer) {
			window.clearInterval(this.frameTimer);
			this.frameTimer = null;
		}

		if (removeVisibilityHandler && this.frameVisibilityHandler) {
			document.removeEventListener('visibilitychange', this.frameVisibilityHandler);
			this.frameVisibilityHandler = null;
		}
	},

	startFramebufferSync: function() {
		var self = this;

		this.stopFramebufferSync(false);

		if (!this.frameVisibilityHandler) {
			this.frameVisibilityHandler = function() {
				if (document.hidden) {
					self.stopFramebufferSync(false);
				} else if (document.querySelector('.display-preview-frame')) {
					self.startFramebufferSync();
				} else {
					self.stopFramebufferSync(true);
				}
			};
			document.addEventListener('visibilitychange', this.frameVisibilityHandler);
		}

		if (document.hidden)
			return;

		/* Do not block initial page rendering on fb0. The selected static theme is
		 * painted immediately, then this first capture replaces it as soon as the
		 * binary frame arrives. */
		this.captureFramebuffer();
		this.frameTimer = window.setInterval(function() {
			if (!document.querySelector('.display-preview-frame')) {
				self.stopFramebufferSync(true);
				return;
			}

			self.captureFramebuffer();
		}, FRAME_REFRESH_MS);
	},

	previewImage: function() {
		return this.screenImage(this.state && this.state.enabled ? this.state.screen : 0);
	},

	currentScreenTitle: function() {
		if (!this.state || !this.state.enabled)
			return _('显示已关闭');

		return SCREENS[this.state.screen - 1].title;
	},

	clamp: function(value, min, max) {
		value = parseInt(value, 10);
		if (isNaN(value))
			value = min;

		return Math.max(min, Math.min(max, value));
	},

	brightnessToPercent: function(raw, max) {
		raw = this.clamp(raw, 0, max);
		if (!max)
			return 0;

		return this.clamp(Math.round((max - raw) * 100 / max), 0, 100);
	},

	percentToBrightness: function(percent) {
		var max = this.state && this.state.maxBrightness ? this.state.maxBrightness : 26;

		percent = this.clamp(percent, 0, 100);
		return this.clamp(Math.round(max * (100 - percent) / 100), 0, max);
	},

	displayBrightnessValue: function(raw) {
		var max = this.state && this.state.maxBrightness ? this.state.maxBrightness : 26;

		return this.clamp(max - this.clamp(raw, 0, max), 0, max);
	},

	setRangeValue: function(range, percent) {
		var wrap;

		percent = this.clamp(percent, 0, 100);

		if (!range)
			return;

		range.value = percent;
		wrap = range.closest ? range.closest('.display-range') : range.parentNode;

		if (wrap) {
			wrap.style.setProperty('--value', percent + '%');
			wrap.style.setProperty('--value-num', String(percent / 100));
		}
	},

	rangeControl: function(percent, className, onInput, onChange) {
		percent = this.clamp(percent, 0, 100);

		return E('span', {
			class: 'display-range ' + (className || ''),
			style: '--value:' + percent + '%;--value-num:' + (percent / 100)
		}, [
			E('input', {
				class: 'display-slider',
				type: 'range',
				min: '0',
				max: '100',
				value: String(percent),
				input: onInput,
				change: onChange
			})
		]);
	},

	parseStatus: function(result) {
		var data = {};

		try {
			data = JSON.parse((result && result.stdout ? result.stdout : '').trim() || '{}');
		} catch (e) {
			data = {};
		}

		return data.ok ? data : {};
	},

	uciBool: function(option, fallback) {
		var value = uci.get('display', 'settings', option);

		if (value == null)
			return !!fallback;

		return value === '1' || value === 'true' || value === 'on';
	},

	readState: function(status) {
		var max = this.clamp(status.max_brightness || 26, 1, 255);
		var raw = this.clamp(status.brightness != null ? status.brightness : max, 0, max);
		var savedPercent = this.clamp(uci.get('display', 'settings', 'brightness_percent') || 72, 0, 100);
		/* The helper reads committed UCI directly, so prefer it over LuCI's
		 * potentially stale in-memory cache after an immediate page refresh. */
		var screen = this.clamp(status.screen || uci.get('display', 'settings', 'screen') || 1, 1, 4);
		var hardwarePercent = status.brightness != null ? this.brightnessToPercent(raw, max) : savedPercent;

		this.state = {
			enabled: status.enabled != null ? status.enabled !== 0 : this.uciBool('enabled', true),
			maxBrightness: max,
			rawBrightness: raw,
			percent: hardwarePercent,
			screen: screen,
			timerEnabled: this.uciBool('timer_enabled', false),
			powerOnEnabled: this.uciBool('power_on_enabled', false),
			powerOnTime: uci.get('display', 'settings', 'power_on_time') || '07:30',
			powerOffEnabled: this.uciBool('power_off_enabled', false),
			powerOffTime: uci.get('display', 'settings', 'power_off_time') || '22:00',
			brightnessScheduleEnabled: this.uciBool('brightness_schedule_enabled', false),
			brightnessSlots: [
				{ key: 'slot2', name: _('日间模式'), time: uci.get('display', 'settings', 'brightness_slot2_time') || '08:30', percent: this.clamp(uci.get('display', 'settings', 'brightness_slot2_percent') || 80, 0, 100) },
				{ key: 'slot3', name: _('夜间模式'), time: uci.get('display', 'settings', 'brightness_slot3_time') || '21:30', percent: this.clamp(uci.get('display', 'settings', 'brightness_slot3_percent') || 10, 0, 100) }
			]
		};

		this.frameInfo = {
			width: this.clamp(status.fb_width || 428, 1, 4096),
			height: this.clamp(status.fb_height || 142, 1, 4096),
			bpp: this.clamp(status.fb_bpp || 16, 1, 64),
			stride: this.clamp(status.fb_stride || 856, 1, 1048576)
		};
	},

	runHelper: function(args) {
		return fs.exec(HELPER, args).then(function(result) {
			var message = result && result.stderr ? result.stderr.trim() : '';
			var json = {};

			try {
				json = JSON.parse((result && result.stdout ? result.stdout : '').trim() || '{}');
			} catch (e) {
				json = {};
			}

			if (result && result.code)
				throw new Error((json && json.message) || message || _('Command failed'));

			if (json && json.ok === false)
				throw new Error(json.message || _('Command failed'));

			return json;
		});
	},

	fireHelper: function(args) {
		fs.exec(HELPER, args).catch(function() {});
	},

	refreshLuCIChanges: function() {
		if (!(ui.changes && ui.changes.init))
			return;

		window.setTimeout(function() {
			ui.changes.init();
		}, 900);

		window.setTimeout(function() {
			ui.changes.init();
		}, 2200);
	},

	showToast: function(message) {
		var toast = document.querySelector('.display-toast');

		if (!toast) {
			toast = document.body.appendChild(E('div', { class: 'display-toast' }));
		}

		toast.textContent = message;
		toast.classList.add('is-visible');

		if (this.toastTimer)
			window.clearTimeout(this.toastTimer);

		this.toastTimer = window.setTimeout(function() {
			toast.classList.remove('is-visible');
		}, 2600);
	},

	updateBrightnessDom: function() {
		var range = document.querySelector('.display-main-range .display-slider');
		var percent = document.querySelector('.display-percent');
		var mobilePercent = document.querySelector('.display-mobile-percent');
		var raw = document.querySelector('.display-raw-value');

		this.setRangeValue(range, this.state.percent);

		if (percent)
			percent.textContent = this.state.percent + '%';

		if (mobilePercent)
			mobilePercent.textContent = this.state.percent + '%';

		if (raw)
			raw.textContent = this.displayBrightnessValue(this.percentToBrightness(this.state.percent));
	},

	updateScreenDom: function() {
		var label = document.querySelector('.display-current-screen');
		var cards = document.querySelectorAll('.display-screen-card');
		var i;

		this.updateLivePreviewDom();

		if (label)
			label.textContent = this.currentScreenTitle();

		for (i = 0; i < cards.length; i++)
			cards[i].classList.toggle('is-active', parseInt(cards[i].getAttribute('data-screen'), 10) === this.state.screen);
	},

	updateScreenSelectionDom: function(screen) {
		var cards = document.querySelectorAll('.display-screen-card');
		var i;

		for (i = 0; i < cards.length; i++)
			cards[i].classList.toggle('is-active', parseInt(cards[i].getAttribute('data-screen'), 10) === screen);
	},

	updateFeatureDom: function() {
		var input = document.querySelector('.display-master-switch input');

		if (input)
			input.checked = !!this.state.enabled;

		this.updateScreenDom();
	},

	applyBrightness: function() {
		var self = this;
		var raw = this.percentToBrightness(this.state.percent);

		this.state.rawBrightness = raw;
		this.updateBrightnessDom();

		if (!this.state.enabled)
			return this.persistSettings();

		/* Dragging only updates the preview. On release, apply the final
		 * hardware value first, then perform exactly one durable UCI commit. */
		return this.runHelper([ 'brightness', String(raw) ]).then(function() {
			return self.persistSettings();
		}).catch(function(error) {
			self.showToast(error.message || _('设置应用失败'));
		});
	},

	selectScreen: function(screen) {
		var self = this;
		var selected = this.clamp(screen, 1, 4);
		var generation, operation;

		if (selected === this.state.screen)
			return this.captureFramebuffer();

		this.frameGeneration = (this.frameGeneration || 0) + 1;
		generation = this.frameGeneration;
		this.frameSyncPaused = false;
		this.pendingScreen = null;
		this.state.screen = selected;

		/* Click fires on button release. Update the selected state immediately and
		 * keep the existing canvas visible while the 100 ms live loop observes the
		 * first frame from the newly started display process. */
		this.updateScreenDom();

		/* One RPC both commits the selected screen and applies it. This avoids
		 * the old split-request state where hardware changed but UCI stayed at 1.
		 * Do not queue behind a previous global sync: each release starts its screen
		 * now, while stale replies are ignored through frameGeneration. */
		operation = this.runHelper([ 'screen-persist', String(selected) ]);

		/* Start capturing now instead of waiting for commit + sync to return. An
		 * in-flight older capture is rejected by its generation check and the next
		 * 100 ms tick picks up the new framebuffer automatically. */
		this.captureFramebuffer();

		return operation.then(function(result) {
			if (parseInt(result.screen, 10) !== selected)
				throw new Error(_('Screen persistence verification failed'));

			if (generation !== self.frameGeneration)
				return;

			/* Make one final capture after persistence completes. Normally the live
			 * interval has already updated several times before this point. */
			return self.captureFramebuffer();
		}).catch(function(error) {
			if (generation !== self.frameGeneration)
				return;

			self.showToast(error.message || _('设置应用失败'));
		});
	},

	settingsArgs: function(command) {
		return [
			command,
			this.state.enabled ? '1' : '0',
			String(this.state.percent),
			String(this.state.screen),
			this.state.timerEnabled ? '1' : '0',
			this.state.powerOnEnabled ? '1' : '0',
			this.state.powerOnTime || '07:30',
			this.state.powerOffEnabled ? '1' : '0',
			this.state.powerOffTime || '22:00',
			this.state.brightnessScheduleEnabled ? '1' : '0',
			this.state.brightnessSlots[0].time || '08:30',
			String(this.state.brightnessSlots[0].percent),
			this.state.brightnessSlots[1].time || '21:30',
			String(this.state.brightnessSlots[1].percent)
		];
	},

	persistSettings: function() {
		var self = this;
		var args = this.settingsArgs('persist');

		return this.runHelper(args).catch(function(error) {
			self.showToast(error.message || _('设置应用失败'));
		});
	},

	setFeatureEnabled: function(enable) {
		var self = this;
		var previous = this.state.enabled;
		var desired = !!enable;
		var generation;
		var operation;

		this.frameGeneration = (this.frameGeneration || 0) + 1;
		generation = this.frameGeneration;
		this.frameSyncPaused = true;
		this.frameBuffer = null;
		this.state.enabled = desired;
		this.updateFeatureDom();

		/* Serialize total-switch clicks and let one helper RPC own UCI, panel
		 * power and display process state. The old parallel apply/off request was
		 * able to finish out of order and made F5 read a stale enabled value. */
		operation = (this.featureQueue || Promise.resolve()).catch(function() {}).then(function() {
			return self.runHelper([ desired ? 'enable' : 'disable' ]);
		});
		this.featureQueue = operation;

		return operation.then(function() {
			if (generation !== self.frameGeneration)
				return;

			self.frameSyncPaused = false;
			self.updateFeatureDom();
			if (desired)
				return self.captureFramebuffer();
		}).catch(function(error) {
			if (generation !== self.frameGeneration)
				return;

			self.frameSyncPaused = false;
			self.state.enabled = previous;
			self.updateFeatureDom();
			self.showToast(error.message || _('显示开关操作失败'));
		});
	},

	switchControl: function(checked, change, className) {
		return E('label', { class: 'display-switch' + (className ? ' ' + className : '') }, [
			E('input', {
				type: 'checkbox',
				checked: checked ? true : null,
				change: change
			}),
			E('span', {})
		]);
	},

	timePart: function(value) {
		value = parseInt(value, 10);
		if (isNaN(value))
			value = 0;

		return value < 10 ? '0' + value : String(value);
	},

	normalizeTime: function(value) {
		var parts = String(value || '').split(':');
		var hour = this.clamp(parts[0], 0, 23);
		var minute = this.clamp(parts[1], 0, 59);

		return this.timePart(hour) + ':' + this.timePart(minute);
	},

	closeTimePickers: function(except) {
		var fields = document.querySelectorAll('.display-time-field.is-open');
		var i;

		for (i = 0; i < fields.length; i++) {
			if (fields[i] !== except)
				fields[i].classList.remove('is-open');
		}
	},

	openTimePicker: function(field) {
		if (!this.timePickerBound) {
			document.addEventListener('click', L.bind(function(ev) {
				if (!ev.target.closest || !ev.target.closest('.display-time-field'))
					this.closeTimePickers();
			}, this));
			this.timePickerBound = true;
		}

		this.closeTimePickers(field);
		field.classList.toggle('is-open');
	},

	selectTimePart: function(field, part, value, change) {
		var current = this.normalizeTime(field.getAttribute('data-value'));
		var pieces = current.split(':');
		var next;
		var valueNode = field.querySelector('.display-time-value');

		if (part === 'hour')
			pieces[0] = value;
		else
			pieces[1] = value;

		next = pieces[0] + ':' + pieces[1];
		field.setAttribute('data-value', next);

		if (valueNode)
			valueNode.textContent = next;

		this.updateTimePicker(field, change);

		if (change)
			change({ target: { value: next } });
	},

	stepTimePart: function(field, part, delta, change) {
		var current = this.normalizeTime(field.getAttribute('data-value'));
		var pieces = current.split(':');
		var count = part === 'hour' ? 24 : 60;
		var idx = part === 'hour' ? 0 : 1;
		var value = (parseInt(pieces[idx], 10) + delta) % count;

		if (value < 0)
			value += count;

		this.selectTimePart(field, part, this.timePart(value), change);
	},

	updateTimePicker: function(field, change) {
		var current = this.normalizeTime(field.getAttribute('data-value'));
		var parts = current.split(':');
		var columns = field.querySelectorAll('.display-time-column');

		if (columns[0])
			dom.content(columns[0], this.timeOptions('hour', parts[0], 24, change));

		if (columns[1])
			dom.content(columns[1], this.timeOptions('minute', parts[1], 60, change));
	},

	timeOptions: function(part, selected, count, change) {
		var self = this;
		var items = [];
		var selectedInt = this.clamp(selected, 0, count - 1);
		var value;
		var raw;
		var i;

		for (i = -2; i <= 2; i++) {
			raw = (selectedInt + i) % count;
			if (raw < 0)
				raw += count;

			value = this.timePart(raw);
			items.push(E('button', {
				class: 'display-time-option' + (value === selected ? ' is-selected' : ''),
				type: 'button',
				'data-part': part,
				'data-value': value,
				click: function(ev) {
					var field = ev.currentTarget.closest('.display-time-field');
					self.selectTimePart(field, ev.currentTarget.getAttribute('data-part'), ev.currentTarget.getAttribute('data-value'), change);
				},
				wheel: function(ev) {
					var field = ev.currentTarget.closest('.display-time-field');
					ev.preventDefault();
					self.stepTimePart(field, ev.currentTarget.getAttribute('data-part'), ev.deltaY > 0 ? 1 : -1, change);
				}
			}, value));
		}

		return items;
	},

	timeInput: function(value, change) {
		var self = this;
		var time = this.normalizeTime(value);
		var parts = time.split(':');

		return E('span', { class: 'display-time-field', 'data-value': time }, [
			E('button', {
				class: 'display-time-trigger',
				type: 'button',
				click: function(ev) {
					ev.preventDefault();
					self.openTimePicker(ev.currentTarget.closest('.display-time-field'));
				}
			}, [
				E('span', { class: 'display-time-value' }, time),
				E('span', { class: 'display-time-clock' }, [
					this.icon('clock')
				])
			]),
			E('span', { class: 'display-time-picker' }, [
				E('span', {
					class: 'display-time-column',
					wheel: function(ev) {
						var field = ev.currentTarget.closest('.display-time-field');
						ev.preventDefault();
						self.stepTimePart(field, 'hour', ev.deltaY > 0 ? 1 : -1, change);
					}
				}, this.timeOptions('hour', parts[0], 24, change)),
				E('span', {
					class: 'display-time-column',
					wheel: function(ev) {
						var field = ev.currentTarget.closest('.display-time-field');
						ev.preventDefault();
						self.stepTimePart(field, 'minute', ev.deltaY > 0 ? 1 : -1, change);
					}
				}, this.timeOptions('minute', parts[1], 60, change))
			])
		]);
	},

	renderBrightnessCard: function() {
		var self = this;

		return E('section', { class: 'display-card' }, [
			E('div', { class: 'display-head' }, [
				E('div', { class: 'display-title' }, [
					this.icon('sun'),
					E('span', {}, _('亮度调节'))
				])
			]),
			E('div', { class: 'display-row' }, [
				E('span', { class: 'display-mobile-brightness-line' }, [
					E('span', { class: 'display-label' }, _('亮度')),
					E('strong', { class: 'display-mobile-percent' }, this.state.percent + '%')
				]),
				E('strong', { class: 'display-percent' }, this.state.percent + '%'),
				this.rangeControl(this.state.percent, 'display-main-range', function(ev) {
					self.state.percent = self.clamp(ev.target.value, 0, 100);
					self.updateBrightnessDom();
				}, function() {
					self.applyBrightness();
				}),
				this.icon('sun')
			]),
			E('div', { class: 'display-stats' }, [
				E('div', { class: 'display-stat' }, [
					E('span', {}, _('当前亮度值')),
					E('strong', { class: 'display-raw-value' }, String(this.displayBrightnessValue(this.percentToBrightness(this.state.percent))))
				]),
				E('div', { class: 'display-stat' }, [
					E('span', {}, _('最大亮度值')),
					E('strong', {}, String(this.state.maxBrightness))
				])
			])
		]);
	},

	renderTimerCard: function() {
		var self = this;

		return E('section', { class: 'display-card display-compact-card display-timer-card' }, [
			E('div', { class: 'display-head' }, [
				E('div', { class: 'display-title' }, [
					this.icon('clock'),
					E('span', {}, _('定时开关'))
				]),
				this.switchControl(this.state.timerEnabled, function(ev) {
					self.state.timerEnabled = ev.target.checked;
					self.persistSettings();
				})
			]),
			E('div', { class: 'display-time-grid' }, [
				E('div', { class: 'display-time-row' }, [
					E('div', { class: 'display-power-row' }, [
						E('span', { class: 'display-switch-text' }, [
							E('span', {}, _('定时开启'))
						]),
						this.timeInput(this.state.powerOnTime, function(ev) {
							self.state.powerOnTime = ev.target.value || '07:30';
							self.persistSettings();
						}),
						this.switchControl(this.state.powerOnEnabled, function(ev) {
							self.state.powerOnEnabled = ev.target.checked;
							self.persistSettings();
						})
					])
				]),
				E('div', { class: 'display-time-row' }, [
					E('div', { class: 'display-power-row' }, [
						E('span', { class: 'display-switch-text' }, [
							E('span', {}, _('定时关闭'))
						]),
						this.timeInput(this.state.powerOffTime, function(ev) {
							self.state.powerOffTime = ev.target.value || '22:00';
							self.persistSettings();
						}),
						this.switchControl(this.state.powerOffEnabled, function(ev) {
							self.state.powerOffEnabled = ev.target.checked;
							self.persistSettings();
						})
					])
				])
			])
		]);
	},

	renderScheduleCard: function() {
		var self = this;

		return E('section', { class: 'display-card display-compact-card display-schedule-card' }, [
			E('div', { class: 'display-head' }, [
				E('div', { class: 'display-title' }, [
					this.icon('clock'),
					E('span', {}, _('定时亮度调节'))
				]),
				this.switchControl(this.state.brightnessScheduleEnabled, function(ev) {
					self.state.brightnessScheduleEnabled = ev.target.checked;
					self.persistSettings();
				})
			]),
			E('div', { class: 'display-time-grid' }, this.state.brightnessSlots.map(function(slot, idx) {
				return E('div', { class: 'display-schedule-row', 'data-slot': String(idx) }, [
					E('span', { class: 'display-schedule-name' }, slot.name),
					self.timeInput(slot.time, function(ev) {
						slot.time = ev.target.value || slot.time;
						self.persistSettings();
					}),
					self.rangeControl(slot.percent, 'display-slot-range', function(ev) {
						var row = ev.target.closest ? ev.target.closest('.display-schedule-row') : ev.target.parentNode.parentNode;
						var percent = self.clamp(ev.target.value, 0, 100);
						var label = row ? row.querySelector('.display-schedule-percent') : null;

						slot.percent = percent;
						self.setRangeValue(ev.target, percent);

						if (label)
							label.textContent = percent + '%';
					}, function() {
						self.persistSettings();
					}),
					E('span', { class: 'display-schedule-percent' }, slot.percent + '%')
				]);
			}))
		]);
	},

	renderPreviewCard: function() {
		return E('section', { class: 'display-card display-preview' }, [
			E('div', { class: 'display-head' }, [
				E('div', { class: 'display-title' }, [
					this.icon('screen'),
					E('span', {}, _('实时预览'))
				])
			]),
			E('div', { class: 'display-preview-frame' }, [
				this.renderPreviewVisual()
			]),
			E('div', { class: 'display-preview-foot' }, [
				E('span', {}, _('当前显示界面：')),
				E('strong', { class: 'display-current-screen' }, this.currentScreenTitle())
			])
		]);
	},

	renderScreenCard: function(item) {
		var self = this;

		return E('div', {
			class: 'display-screen-card' + (item.id === this.state.screen ? ' is-active' : ''),
			role: 'button',
			tabindex: '0',
			'data-screen': String(item.id),
			click: function() {
				self.selectScreen(item.id);
			},
			keydown: function(ev) {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault();
					self.selectScreen(item.id);
				}
			}
		}, [
			E('span', { class: 'display-radio' }),
			E('span', { class: 'display-screen-card-title' }, item.title),
			E('span', { class: 'display-screen-image' }, [
				E('img', { src: this.screenImage(item.id), alt: item.title })
			])
		]);
	},

	renderScreenSelect: function() {
		return E('section', { class: 'display-select' }, [
			E('div', { class: 'display-section-title' }, _('选择显示界面')),
			E('div', { class: 'display-screens' }, SCREENS.map(L.bind(this.renderScreenCard, this)))
		]);
	},

	renderPageHeader: function() {
		var self = this;

		return E('div', { class: 'display-page-head' }, [
			E('h2', {}, _('屏幕控制')),
			this.switchControl(this.state.enabled, function(ev) {
				self.setFeatureEnabled(ev.target.checked);
			}, 'display-master-switch')
		]);
	},

	render: function(data) {
		var page;

		this.addStyle();
		this.readState(this.parseStatus(data[0]));
		this.frameBuffer = null;

		page = E('div', { class: 'display-page' }, [
			this.renderPageHeader(),
			E('div', { class: 'display-app' }, [
				E('div', { class: 'display-grid' }, [
					E('div', { class: 'display-left' }, [
						this.renderBrightnessCard(),
						E('div', { class: 'display-two' }, [
							this.renderTimerCard(),
							this.renderScheduleCard()
						])
					]),
					this.renderPreviewCard()
				]),
				this.renderScreenSelect()
			])
		]);

		window.setTimeout(L.bind(this.startFramebufferSync, this), 0);
		return page;
	}
});
