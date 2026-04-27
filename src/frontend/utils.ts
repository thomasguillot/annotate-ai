/**
 * Pure helpers used by the toolbar. Extracted out of Toolbar.tsx so they
 * can be unit-tested in isolation (Jest + jsdom).
 */

export const STYLE_KEYS = [
	'font-size',
	'font-family',
	'font-weight',
	'line-height',
	'color',
	'background-color',
	'padding',
	'margin',
	'width',
	'height',
	'display',
	'text-align',
	'border',
	'border-radius',
	'gap',
	'flex-direction',
] as const;

export function cssEscape( value: string ): string {
	if (
		typeof window !== 'undefined' &&
		typeof window.CSS !== 'undefined' &&
		typeof window.CSS.escape === 'function'
	) {
		return window.CSS.escape( value );
	}
	return String( value ).replace(
		/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g,
		'\\$1'
	);
}

export function getSelector( el: Element ): string {
	if ( el instanceof HTMLElement && el.id ) {
		return '#' + cssEscape( el.id );
	}
	const parts: string[] = [];
	let current: Element | null = el;
	let isLeaf = true;
	while ( current && current !== document.body && parts.length < 5 ) {
		let part = current.tagName.toLowerCase();
		if ( current instanceof HTMLElement && current.id && ! isLeaf ) {
			parts.unshift( '#' + cssEscape( current.id ) );
			break;
		}
		if (
			current instanceof HTMLElement &&
			current.className &&
			typeof current.className === 'string'
		) {
			const classes = current.className
				.split( /\s+/ )
				.filter( ( c ) => c && ! c.startsWith( 'aai-' ) )
				.slice( 0, 3 )
				.map( ( c ) => '.' + cssEscape( c ) )
				.join( '' );
			if ( classes ) {
				part += classes;
			}
		}
		const parent = current.parentElement;
		if ( parent ) {
			const sameTag = Array.from( parent.children ).filter(
				( s ) => s.tagName === current!.tagName
			);
			if ( sameTag.length > 1 || isLeaf ) {
				part +=
					':nth-of-type(' +
					( sameTag.indexOf( current ) + 1 ) +
					')';
			}
		}
		parts.unshift( part );
		current = current.parentElement;
		isLeaf = false;
	}
	return parts.join( ' > ' );
}

export function getComputedStylesFor(
	el: Element
): Record< string, string > {
	const cs = window.getComputedStyle( el );
	const styles: Record< string, string > = {};
	STYLE_KEYS.forEach( ( k ) => {
		const val = cs.getPropertyValue( k );
		if ( val ) {
			styles[ k ] = val;
		}
	} );
	return styles;
}

export function getElementText( el: Element ): string {
	return ( el.textContent || '' )
		.trim()
		.replace( /\s+/g, ' ' )
		.substring( 0, 200 );
}

export function generateClientId(): string {
	return (
		'aai_' +
		Date.now().toString( 36 ) +
		'_' +
		Math.random().toString( 36 ).slice( 2, 8 )
	);
}
