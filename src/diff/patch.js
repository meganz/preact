import { Fragment } from '../create-element';
import { diffChildren } from './children';
import { diffProps, setProperty } from './props';
import { assign } from '../util';
import options from '../options';
import { doRender } from './mount';
import { Component, getDomSibling } from '../component';

/**
 * Diff two virtual nodes and apply proper changes to the DOM
 * @param {import('../internal').PreactElement} parentDom The parent of the DOM element
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} globalContext The current context object. Modified by getChildContext
 * @param {boolean} isSvg Whether or not this element is an SVG node
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {import('../internal').PreactElement} startDom
 */
export function patch(
	parentDom,
	newVNode,
	oldVNode,
	globalContext,
	isSvg,
	commitQueue,
	startDom
) {
	let tmp,
		newType = newVNode.type;

	// When passing through createElement it assigns the object
	// constructor as undefined. This to prevent JSON-injection.
	if (newVNode.constructor !== undefined) return null;
	if ((tmp = options._diff)) tmp(newVNode);

	try {
		if (typeof newType == 'function') {
			patchComponent(
				parentDom,
				newVNode,
				oldVNode,
				globalContext,
				isSvg,
				commitQueue,
				startDom
			);
		} else if (newVNode._original === oldVNode._original) {
			newVNode._children = oldVNode._children;
			newVNode._dom = oldVNode._dom;
		} else {
			newVNode._dom = patchDOMElement(
				oldVNode._dom,
				newVNode,
				oldVNode,
				globalContext,
				isSvg,
				commitQueue
			);
		}

		if ((tmp = options.diffed)) tmp(newVNode);
	} catch (e) {
		newVNode._original = null;
		options._catchError(e, newVNode, oldVNode);
	}
}

/**
 * Diff two virtual nodes and apply proper changes to the DOM
 * @param {import('../internal').PreactElement} parentDom The parent of the DOM element
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} globalContext The current context object. Modified by getChildContext
 * @param {boolean} isSvg Whether or not this element is an SVG node
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @param {import('../internal').PreactElement} startDom The current attached DOM
 * element any new dom elements should be placed around. Likely `null` on first
 * render (except when hydrating). Can be a sibling DOM element when diffing
 * Fragments that have siblings. In most cases, it starts out as `oldChildren[0]._dom`.
 */
function patchComponent(
	parentDom,
	newVNode,
	oldVNode,
	globalContext,
	isSvg,
	commitQueue,
	startDom
) {
	/** @type {import('../internal').Component} */
	let c;
	let isNew, oldProps, oldState, snapshot, clearProcessingException, tmp;

	/** @type {import('../internal').ComponentType} */
	let newType = newVNode.type;
	let newProps = newVNode.props;

	// Necessary for createContext api. Setting this property will pass
	// the context value as `this.context` just for this component.
	tmp = newType.contextType;
	let provider = tmp && globalContext[tmp._id];
	let componentContext = tmp
		? provider
			? provider.props.value
			: tmp._defaultValue
		: globalContext;

	if (oldVNode._component) {
		c = newVNode._component = oldVNode._component;
		clearProcessingException = c._processingException = c._pendingError;
	} else {
		// Instantiate the new component
		if ('prototype' in newType && newType.prototype.render) {
			// @ts-ignore The check above verifies that newType is suppose to be constructed
			newVNode._component = c = new newType(newProps, componentContext); // eslint-disable-line new-cap
		} else {
			// @ts-ignore Trust me, Component implements the interface we want
			newVNode._component = c = new Component(newProps, componentContext);
			c.constructor = newType;
			c.render = doRender;
		}
		if (provider) provider.sub(c);

		c.props = newProps;
		if (!c.state) c.state = {};
		c.context = componentContext;
		c._globalContext = globalContext;
		isNew = c._dirty = true;
		c._renderCallbacks = [];
	}

	// Invoke getDerivedStateFromProps
	if (c._nextState == null) {
		c._nextState = c.state;
	}
	if (newType.getDerivedStateFromProps != null) {
		if (c._nextState == c.state) {
			c._nextState = assign({}, c._nextState);
		}

		assign(
			c._nextState,
			newType.getDerivedStateFromProps(newProps, c._nextState)
		);
	}

	oldProps = c.props;
	oldState = c.state;

	// Invoke pre-render lifecycle methods
	if (
		newType.getDerivedStateFromProps == null &&
		newProps !== oldProps &&
		c.componentWillReceiveProps != null
	) {
		c.componentWillReceiveProps(newProps, componentContext);
	}

	if (
		(!c._force &&
			c.shouldComponentUpdate != null &&
			c.shouldComponentUpdate(newProps, c._nextState, componentContext) ===
				false) ||
		newVNode._original === oldVNode._original
	) {
		c.props = newProps;
		c.state = c._nextState;
		// More info about this here: https://gist.github.com/JoviDeCroock/bec5f2ce93544d2e6070ef8e0036e4e8
		if (newVNode._original !== oldVNode._original) c._dirty = false;
		c._vnode = newVNode;
		newVNode._dom = oldVNode._dom;
		newVNode._children = oldVNode._children;
		if (c._renderCallbacks.length) {
			commitQueue.push(c);
		}

		return;
	}

	if (c.componentWillUpdate != null) {
		c.componentWillUpdate(newProps, c._nextState, componentContext);
	}

	if (c.componentDidUpdate != null) {
		c._renderCallbacks.push(() => {
			c.componentDidUpdate(oldProps, oldState, snapshot);
		});
	}

	c.context = componentContext;
	c.props = newProps;
	c.state = c._nextState;

	if ((tmp = options._render)) tmp(newVNode);

	c._dirty = false;
	c._vnode = newVNode;
	c._parentDom = parentDom;

	tmp = c.render(c.props, c.state, c.context);

	// Handle setState called in render, see #2553
	c.state = c._nextState;

	if (c.getChildContext != null) {
		globalContext = assign(assign({}, globalContext), c.getChildContext());
	}

	if (!isNew && c.getSnapshotBeforeUpdate != null) {
		snapshot = c.getSnapshotBeforeUpdate(oldProps, oldState);
	}

	let isTopLevelFragment =
		tmp != null && tmp.type === Fragment && tmp.key == null;
	let renderResult = isTopLevelFragment ? tmp.props.children : tmp;

	diffChildren(
		parentDom,
		Array.isArray(renderResult) ? renderResult : [renderResult],
		newVNode,
		oldVNode,
		globalContext,
		isSvg,
		commitQueue,
		startDom
	);

	c.base = newVNode._dom;

	if (c._renderCallbacks.length) {
		commitQueue.push(c);
	}

	if (clearProcessingException) {
		c._pendingError = c._processingException = null;
	}

	c._force = false;
}

/**
 * Diff two virtual nodes representing DOM element
 * @param {import('../internal').PreactElement} dom The DOM element representing
 * the virtual nodes being diffed
 * @param {import('../internal').VNode} newVNode The new virtual node
 * @param {import('../internal').VNode} oldVNode The old virtual node
 * @param {object} globalContext The current context object
 * @param {boolean} isSvg Whether or not this DOM node is an SVG node
 * @param {Array<import('../internal').Component>} commitQueue List of components
 * which have callbacks to invoke in commitRoot
 * @returns {import('../internal').PreactElement}
 */
function patchDOMElement(
	dom,
	newVNode,
	oldVNode,
	globalContext,
	isSvg,
	commitQueue
) {
	let i;
	let oldProps = oldVNode.props;
	let newProps = newVNode.props;

	// Tracks entering and exiting SVG namespace when descending through the tree.
	isSvg = newVNode.type === 'svg' || isSvg;

	if (newVNode.type === null) {
		if (oldProps !== newProps) {
			dom.data = newProps;
		}
	} else {
		let oldHtml = oldProps.dangerouslySetInnerHTML;
		let newHtml = newProps.dangerouslySetInnerHTML;

		if (newHtml || oldHtml) {
			// Avoid re-applying the same '__html' if it did not changed between re-render
			if (
				!newHtml ||
				((!oldHtml || newHtml.__html != oldHtml.__html) &&
					newHtml.__html !== dom.innerHTML)
			) {
				dom.innerHTML = (newHtml && newHtml.__html) || '';
			}
		}

		diffProps(dom, newProps, oldProps, isSvg);

		// If the new vnode didn't have dangerouslySetInnerHTML, diff its children
		if (newHtml) {
			newVNode._children = [];
		} else {
			i = newVNode.props.children;
			diffChildren(
				dom,
				Array.isArray(i) ? i : [i],
				newVNode,
				oldVNode,
				globalContext,
				newVNode.type === 'foreignObject' ? false : isSvg,
				commitQueue,
				// Find the first non-null child with a dom pointer and begin the diff
				// with that (i.e. what getDomSibling does)
				getDomSibling(oldVNode, 0)
			);
		}

		if (
			'value' in newProps &&
			(i = newProps.value) !== undefined &&
			// #2756 For the <progress>-element the initial value is 0,
			// despite the attribute not being present. When the attribute
			// is missing the progress bar is treated as indeterminate.
			// To fix that we'll always update it when it is 0 for progress elements
			(i !== dom.value || (newVNode.type === 'progress' && !i))
		) {
			setProperty(dom, 'value', i, oldProps.value, false);
		}
		if (
			'checked' in newProps &&
			(i = newProps.checked) !== undefined &&
			i !== dom.checked
		) {
			setProperty(dom, 'checked', i, oldProps.checked, false);
		}
	}

	return dom;
}
