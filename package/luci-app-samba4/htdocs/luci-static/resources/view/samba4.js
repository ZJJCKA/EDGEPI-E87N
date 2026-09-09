'use strict';
'require view';
'require fs';
'require uci';
'require form';
'require ui';
'require tools.widgets as widgets';

function ensureSambaStylesheet() {
	var id = 'luci-app-samba4-stylesheet';
	if (!document.getElementById(id))
		document.head.appendChild(E('link', {
			'id': id,
			'rel': 'stylesheet',
			'href': L.resource('view/samba4.css')
		}));
}

var SambaPasswordWidget = ui.Textfield.extend({
	render: function() {
		var frame = E('div', {
			'id': this.options.id,
			'class': 'samba-password-control'
		});
		var input = E('input', {
			'id': this.options.id ? 'widget.' + this.options.id : null,
			'type': 'password',
			'class': 'cbi-input-password samba-password-input',
			'autocomplete': 'new-password',
			'disabled': this.options.disabled ? '' : null,
			'value': this.value || ''
		});
		frame.appendChild(input);
		return this.bind(frame);
	}
});
var SambaPasswordValue = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		return new SambaPasswordWidget(cfgvalue || '', {
			id: this.cbid(section_id),
			optional: true,
			validate: L.bind(this.validate, this, section_id),
			disabled: (this.readonly != null) ? this.readonly : this.map.readonly
		}).render();
	}
});

var activeSambaMap = null;
var activeNvmeSection = null;

var NvmeStorageSection = form.TypedSection.extend({
	__init__: function(map, sectiontype, data) {
		this.super('__init__', [ map, sectiontype ]);
		this.nvmeData = data;
	},

	render: function() {
		return renderNvmeStorage(this.nvmeData);
	}
});

/* Samba shares use a fixed application-owned grid.  The generic LuCI table
 * implementation measures the action column after every redraw and writes an
 * inline pixel width, which conflicts with this grid and leaves an empty block
 * after deleting a row.  Keep that generic behaviour for other applications,
 * but disable it for this table at the source. */
var SambaShareTableSection = form.TableSection.extend({
	stabilizeActionColumnWidth: function() {}
});

function showNvmeError(message) {
	ui.showModal(_('NVMe operation not completed'), [
		E('p', { 'class': 'error' }, message),
		E('div', { 'class': 'right' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-neutral',
				'click': ui.hideModal
			}, _('Close'))
		])
	]);
}

function runNvmeAction(action, slot, confirmation) {
	var args = [ action, slot ];
	if (confirmation != null)
		args.push(confirmation);
	ui.showModal(_('NVMe storage'), [
		E('p', { 'class': 'spinning' }, _('Applying the requested operation…'))
	]);
	return fs.exec('/usr/libexec/samba4-nvme', args).then(function(res) {
		ui.hideModal();
		if (res.code !== 0) {
			var message = (res.stderr || res.stdout || _('NVMe operation failed')).trim();
			if (message.charAt(0) !== '【')
				message = '【' + _('NVMe management') + '】' + message;
			throw new Error(message);
		}
		return fs.exec('/usr/libexec/samba4-nvme', [ 'scan' ]).then(function(scan) {
			if (scan.code !== 0)
				throw new Error('【' + _('NVMe management') + '】' + _('The operation succeeded, but refreshing the drive status failed.'));
			var data;
			try { data = JSON.parse(scan.stdout); }
			catch (e) {
				throw new Error('【' + _('NVMe management') + '】' + _('The operation succeeded, but the refreshed drive status is invalid.'));
			}
			if (!activeSambaMap || !activeNvmeSection)
				throw new Error('【' + _('NVMe management') + '】' + _('The operation succeeded, but the Samba view is not ready to refresh.'));
			activeNvmeSection.nvmeData = data;
			/* Both NVMe storage and Shared Directories are real children of the
			 * same form.Map. Reload UCI and redraw that Map in place so Add, Remove,
			 * Save, mount and format always produce one consistent page state. */
			/* The helper changes samba4 through UCI outside this form.  LuCI caches
			 * loaded configs, so a normal Map.load() would redraw the old rows and
			 * make the new share appear only after a forced browser refresh. */
			uci.unload('samba4');
			return activeSambaMap.load().then(function() {
				return activeSambaMap.renderContents();
			});
		});
	}).catch(function(err) {
		ui.hideModal();
		showNvmeError(err.message || String(err));
	});
}

function confirmNvmeFormat(info) {
	var number = info.slot.substring(4);
	var token = 'CONFIRM_NVME' + number;
	ui.showModal(_('Erase and format NVMe storage'), [
		E('p', {}, _('The selected physical drive and every file on it will be permanently erased.')),
		E('ul', {}, [
			E('li', {}, _('Slot: NVMe%s (%s)').format(info.slot.substring(4), info.side === 'right' ? _('right') : _('left'))),
			E('li', {}, _('Controller: %s').format(info.controller || '-')),
			E('li', {}, _('Model: %s').format(info.model || '-')),
			E('li', {}, _('Serial: %s').format(info.serial || '-')),
			E('li', {}, _('Current filesystem: %s').format(info.fstype || _('none'))),
			E('li', {}, _('Existing user data: %s').format(info.content === 'yes' ? _('detected') : info.content === 'no' ? _('not detected') : _('unknown — treat as present')))
		]),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel and keep data')),
			' ',
			E('button', {
				'class': 'btn cbi-button-negative important',
				'click': function() {
					ui.showModal(_('Final confirmation'), [
						E('p', {}, _('Format NVMe%s now? All data will be erased and this operation cannot be undone.').format(number)),
						E('div', { 'class': 'right' }, [
							E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel and keep data')),
							' ',
							E('button', {
								'class': 'btn cbi-button-negative important',
								'click': runNvmeAction.bind(null, 'format', info.slot, token)
							}, _('Confirm format'))
						])
					]);
				}
			}, _('Continue to final confirmation'))
		])
	]);
}

function renderNvmeStorage(data) {
	var slots = data && Array.isArray(data.slots) ? data.slots : [];
	var rows = slots.map(function(info) {
		var number = info.slot.substring(4);
		var location = info.side === 'right' ? _('Right') : info.side === 'left' ? _('Left') : null;
		var actions = [];
		if (!info.present) {
			actions.push(E('span', {}, _('No drive detected')));
		} else if (info.usable === false) {
			actions.push(E('span', {}, _('Controller detected, but no usable namespace')));
		} else {
			if (info.fstype === 'ext4')
				actions.push(E('button', { 'class': 'btn cbi-button-action', 'click': runNvmeAction.bind(null, 'mount', info.slot, null) }, _('Mount and share root')));
			actions.push(E('button', { 'class': 'btn cbi-button-negative', 'click': confirmNvmeFormat.bind(null, info) }, _('Format as ext4')));
		}
		return E('div', { 'class': 'tr cbi-section-table-row' }, [
			E('div', { 'class': 'td', 'data-title': _('Slot') }, 'NVMe' + number + (location ? ' · ' + location : '')),
			E('div', { 'class': 'td', 'data-title': _('Model') }, info.present ? (info.model || '-') : '-'),
			E('div', { 'class': 'td', 'data-title': _('Device') }, info.present ? (info.device || info.disk || '-') : '-'),
			E('div', { 'class': 'td', 'data-title': _('Filesystem') }, info.present ? (info.usable === false ? _('Unavailable') : (info.fstype || _('Unformatted'))) : '-'),
			E('div', { 'class': 'td', 'data-title': _('Existing data') }, info.present ? (info.content === 'yes' ? _('Yes') : info.content === 'no' ? _('No') : _('Unknown')) : '-'),
			E('div', { 'class': 'td', 'data-title': _('Mount point') }, info.present ? (info.mountpoint || _('Not mounted')) : '-'),
			E('div', { 'class': 'td cbi-section-actions', 'data-title': _('Actions') },
				E('div', { 'class': 'samba-nvme-actions' }, actions))
		]);
	});
	return E('section', { 'id': 'samba-nvme-storage', 'class': 'cbi-section samba-nvme-section' }, [
		E('h3', {}, _('NVMe storage')),
		E('p', { 'class': 'cbi-section-descr' }, _('Physical slots are identified by their PCIe controllers. Existing data is never erased automatically. Mounted drive roots are shared with the existing Samba root account; guest access remains disabled.')),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'class': 'table cbi-section-table' }, [
				E('div', { 'class': 'tr cbi-section-table-titles' }, [
					E('div', { 'class': 'th' }, _('Slot')),
					E('div', { 'class': 'th' }, _('Model')),
					E('div', { 'class': 'th' }, _('Device')),
					E('div', { 'class': 'th' }, _('Filesystem')),
					E('div', { 'class': 'th' }, _('Existing data')),
					E('div', { 'class': 'th' }, _('Mount point')),
					E('div', { 'class': 'th' }, _('Actions'))
				])
			].concat(rows))
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.stat('/sbin/block'), null),
			L.resolveDefault(fs.stat('/etc/config/fstab'), null),
			L.resolveDefault(fs.stat('/usr/sbin/nmbd'), {}),
			L.resolveDefault(fs.stat('/usr/sbin/samba'), {}),
			L.resolveDefault(fs.stat('/usr/sbin/winbindd'), {}),
			L.resolveDefault(fs.exec('/usr/sbin/smbd', ['-V']), null),
			L.resolveDefault(fs.exec('/usr/libexec/samba4-nvme', ['scan']), null),
		]);
	},
	render: function(stats) {
		var m, s, o, v, nvmeData;
		ensureSambaStylesheet();
		v = '';
		nvmeData = null;
		if (stats[6] && stats[6].code === 0) {
			try { nvmeData = JSON.parse(stats[6].stdout); }
			catch (e) { nvmeData = null; }
		}

		m = new form.Map('samba4', _('Network Shares'));
		activeSambaMap = m;
		activeNvmeSection = null;

		if (stats[5] && stats[5].code === 0) {
			v = stats[5].stdout.trim();
		}
		s = m.section(form.TypedSection, 'samba', 'Samba ' + v);
		s.anonymous = true;

		s.tab('general',  _('General Settings'));
		s.tab('template', _('Edit Template'), _('Edit the template that is used for generating the samba configuration.'));

		o = s.taboption('general', widgets.NetworkSelect, 'interface', _('Interface'),
			_('Listen only on the given interface or, if unspecified, on lan'));
		o.multiple = true;
		o.cfgvalue = function(section_id) {
			return L.toArray(uci.get('samba4', section_id, 'interface'));
		};
		o.write = function(section_id, formvalue) {
			var cfgvalue = this.cfgvalue(section_id),
				oldNetworks = L.toArray(cfgvalue),
				newNetworks = L.toArray(formvalue);
			oldNetworks.sort();
			newNetworks.sort();
			if (oldNetworks.join(' ') == newNetworks.join(' '))
				return;
			return uci.set('samba4', section_id, 'interface', newNetworks.join(' '));
		};

		o = s.taboption('general', form.Value, 'workgroup', _('Workgroup'));
		o.placeholder = 'WORKGROUP';

		o = s.taboption('general', form.Value, 'description', _('Description'));
		o.placeholder = 'Samba4 on OpenWrt';

		s.taboption('general', form.Flag, 'enable_extra_tuning', _('Enable extra Tuning'),
			_('Enable some community driven tuning parameters, that may improve write speeds and better operation via WiFi.\
			Not recommend if multiple clients write to the same files, at the same time!'));

		s.taboption('general', form.Flag, 'disable_async_io', _('Force synchronous  I/O'),
			_('On lower-end devices may increase speeds, by forcing synchronous I/O instead of the default asynchronous.'));

		s.taboption('general', form.Flag, 'macos', _('Enable macOS compatible shares'),
			_('Enables Apple\'s AAPL extension globally and adds macOS compatibility options to all shares.'));

		s.taboption('general', form.Flag, 'allow_legacy_protocols', _('Allow legacy (insecure) protocols/authentication.'),
			_('Allow legacy smb(v1)/Lanman connections, needed for older devices without smb(v2.1/3) support.'));

		if (stats[2].type === 'file') {
			s.taboption('general', form.Flag, 'disable_netbios', _('Disable Netbios'))
		}
		if (stats[3].type === 'file') {
			s.taboption('general', form.Flag, 'disable_ad_dc', _('Disable Active Directory Domain Controller'))
		}
		if (stats[4].type === 'file') {
			s.taboption('general', form.Flag, 'disable_winbind', _('Disable Winbind'))
		}

		o = s.taboption('template', form.TextValue, '_tmpl',
			null,
			_("This is the content of the file '/etc/samba/smb.conf.template' from which your samba configuration will be generated. \
			Values enclosed by pipe symbols ('|') should not be changed. They get their values from the 'General Settings' tab."));
		o.rows = 20;
		o.cfgvalue = function(section_id) {
			return fs.trimmed('/etc/samba/smb.conf.template');
		};
		o.write = function(section_id, formvalue) {
			return fs.write('/etc/samba/smb.conf.template', formvalue.trim().replace(/\r\n/g, '\n') + '\n');
		};

		if (nvmeData)
			activeNvmeSection = m.section(NvmeStorageSection, '_nvme_storage', nvmeData);

		s = m.section(SambaShareTableSection, 'sambashare', _('Shared Directories'),
			_('Please add directories to share. Each directory refers to a folder on a mounted device.'));
		s.anonymous = true;
		s.addremove = true;
		/* TableSection reserves a final column for row removal.  Give that
		 * structural column a real title instead of leaving a blank cell after
		 * the Time-machine size heading. */
		s.actionstitle = _('Actions');

		s.option(form.Value, 'name', _('Name'));
		o = s.option(form.Value, 'path', _('Path'));
		if (stats[0] && stats[1]) {
			o.titleref = L.url('admin', 'system', 'mounts');
		}

		o = s.option(form.Flag, 'browseable', _('Browse-able'));
		o.enabled = 'yes';
		o.disabled = 'no';
		o.default = 'yes';

		o = s.option(form.Flag, 'read_only', _('Read-only'));
		o.enabled = 'yes';
		o.disabled = 'no';
		o.default = 'no'; // smb.conf default is 'yes'
		o.rmempty = false;

		s.option(form.Flag, 'force_root', _('Force Root'));

		o = s.option(form.Value, 'users', _('Allowed users'));
		o.rmempty = true;

		o = s.option(SambaPasswordValue, '_smb_password', _('User password'));
		/* A dedicated one-input widget avoids LuCI's password reveal helper.  It
		 * therefore remains one control for saved and newly inserted rows alike. */
		o.rmempty = true;
		o.cfgvalue = function() {
			return '';
		};
		o.validate = function(section_id, value) {
			var user = this.map.lookupOption('users', section_id)[0].formvalue(section_id) || '';
			if (!value)
				return true;
			if (!/^[A-Za-z0-9_.-]+$/.test(user))
				return _('Enter one valid account in Allowed users before setting its password.');
			if (value.length < 4)
				return _('The Samba password must contain at least 4 characters.');
			return true;
		};
		o.write = function(section_id, value) {
			var user = this.map.lookupOption('users', section_id)[0].formvalue(section_id) || '';
			if (!value)
				return Promise.resolve();
			return fs.exec('/usr/libexec/samba4-set-password', [ user, value ]).then(function(res) {
				if (res.code !== 0)
					throw new Error((res.stderr || res.stdout || _('Unable to set Samba password')).trim());
			});
		};
		o.remove = function() {};

		o = s.option(form.Flag, 'guest_ok', _('Allow guests'));
		o.enabled = 'yes';
		o.disabled = 'no';
		o.default = 'yes'; // smb.conf default is 'no'
		o.rmempty = false;

		o = s.option(form.Flag, 'guest_only', _('Guests only'));
		o.enabled = 'yes';
		o.disabled = 'no';
		o.default = 'no';

		o = s.option(form.Flag, 'inherit_owner', _('Inherit owner'));
		o.enabled = 'yes';
		o.disabled = 'no';
		o.default = 'no';

		o = s.option(form.Value, 'create_mask', _('Create mask'));
		o.maxlength = 4;
		o.default = '0666'; // smb.conf default is '0744'
		o.placeholder = '0666';
		o.rmempty = false;

		o = s.option(form.Value, 'dir_mask', _('Directory mask'));
		o.maxlength = 4;
		o.default = '0777'; // smb.conf default is '0755'
		o.placeholder = '0777';
		o.rmempty = false;

		o = s.option(form.Value, 'vfs_objects', _('Vfs objects'));
		o.rmempty = true;

		s.option(form.Flag, 'timemachine', _('Apple Time-machine share'));

		o = s.option(form.Value, 'timemachine_maxsize', _('Time-machine size in GB'));
		o.rmempty = true;
		o.maxlength = 5;

		return m.render();
	}
});
