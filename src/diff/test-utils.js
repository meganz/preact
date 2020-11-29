function serializeValue(v) {
	if (typeof v === 'string') {
		return `"${v}"`;
	}
	return v;
}

export function printVNode(vnode) {
	let v = '';
	if (vnode == null) {
		v = null;
	} else if (typeof vnode === 'string') {
		v = vnode;
	} else if (vnode.type == null) {
		v = `text#"${vnode.props}"`;
	} else if (
		typeof vnode.type === 'string' ||
		typeof vnode.type === 'function'
	) {
		const name =
			typeof vnode.type === 'string'
				? vnode.type
				: 'prototype' in vnode.type
				? vnode.type.prototype.constructor.name
				: vnode.type.name;
		const key = vnode.key ? ` key="${vnode.key}"` : '';
		const props = vnode.props
			? Object.keys(vnode.props).reduce((acc, key) => {
					if (key === 'children') return acc;
					const value = serializeValue(vnode.props[key]);
					return (acc += ` ${key}=${value}`);
			  }, '')
			: '';
		const children =
			vnode._children &&
			(vnode._children.every(x => x && x.type === null) ||
				vnode._children.length === 1)
				? vnode._children.map(x => printVNode(x)).join('')
				: vnode._children && vnode._children.length > 0
				? '...'
				: '';
		v = `<${name}${key}${props}`;
		if (children) {
			v += `>${children}</${name}>`;
		}
	}
	return v;
}