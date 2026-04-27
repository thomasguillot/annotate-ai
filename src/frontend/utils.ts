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

/**
 * Spec-compliant CSS.escape polyfill.
 *
 * Mirrors the algorithm from the CSSOM spec / MDN reference implementation
 * so generated selectors remain valid even on environments without
 * `window.CSS.escape`. Handles:
 *  - leading digits (must be hex-escaped)
 *  - leading hyphen + digit
 *  - lone hyphen
 *  - control characters and NULL replacement
 *  - non-ASCII code points (preserved as-is)
 *
 * Reference: https://drafts.csswg.org/cssom/#serialize-an-identifier
 */
function cssEscapePolyfill( value: string ): string {
	const string = String( value );
	const length = string.length;
	const firstCodeUnit = string.charCodeAt( 0 );
	let result = '';
	let index = -1;
	let codeUnit: number;

	if ( length === 1 && firstCodeUnit === 0x002d ) {
		// A lone `-` must be escaped.
		return '\\' + string;
	}

	while ( ++index < length ) {
		codeUnit = string.charCodeAt( index );

		// NULL is replaced with the Unicode REPLACEMENT CHARACTER.
		if ( codeUnit === 0x0000 ) {
			result += '�';
			continue;
		}

		// Control chars + DEL → hex escape with trailing space.
		// Also: a leading digit, or `-` followed by a digit, must be hex-escaped.
		if (
			( codeUnit >= 0x0001 && codeUnit <= 0x001f ) ||
			codeUnit === 0x007f ||
			( index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039 ) ||
			( index === 1 &&
				codeUnit >= 0x0030 &&
				codeUnit <= 0x0039 &&
				firstCodeUnit === 0x002d )
		) {
			result += '\\' + codeUnit.toString( 16 ) + ' ';
			continue;
		}

		// Non-ASCII, alphanumerics, `-`, `_` pass through unescaped.
		if (
			codeUnit >= 0x0080 ||
			codeUnit === 0x002d ||
			codeUnit === 0x005f ||
			( codeUnit >= 0x0030 && codeUnit <= 0x0039 ) ||
			( codeUnit >= 0x0041 && codeUnit <= 0x005a ) ||
			( codeUnit >= 0x0061 && codeUnit <= 0x007a )
		) {
			result += string.charAt( index );
			continue;
		}

		// Everything else is backslash-escaped literally.
		result += '\\' + string.charAt( index );
	}
	return result;
}

export function cssEscape( value: string ): string {
	if (
		typeof window !== 'undefined' &&
		typeof window.CSS !== 'undefined' &&
		typeof window.CSS.escape === 'function'
	) {
		return window.CSS.escape( value );
	}
	return cssEscapePolyfill( value );
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
