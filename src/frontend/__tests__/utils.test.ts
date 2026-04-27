/**
 * Unit tests for the toolbar's pure helpers.
 * Run with: npm run test:unit
 *
 * @jest-environment jsdom
 */

import {
	cssEscape,
	generateClientId,
	getComputedStylesFor,
	getElementText,
	getSelector,
} from '../utils';

describe( 'cssEscape', () => {
	it( 'escapes the colon, which would break a selector inside #id', () => {
		expect( cssEscape( 'foo:bar' ) ).toBe( 'foo\\:bar' );
	} );

	it( 'escapes square brackets', () => {
		expect( cssEscape( 'a[b]' ) ).toMatch( /\\\[/ );
	} );

	it( 'leaves alphanumerics alone', () => {
		expect( cssEscape( 'plain123' ) ).toBe( 'plain123' );
	} );

	const trickyCases: Array< [ string, string ] > = [
		[ '1leading-digit', '\\31 leading-digit' ],
		[ '-1', '-\\31 ' ],
		[ '-', '\\-' ],
		[ 'foo:bar', 'foo\\:bar' ],
		[ 'a.b', 'a\\.b' ],
	];

	it( 'produces correct output for tricky inputs (native path)', () => {
		// Goes through window.CSS.escape, which jsdom provides.
		for ( const [ input, expected ] of trickyCases ) {
			expect( cssEscape( input ) ).toBe( expected );
		}
	} );

	it( 'polyfill branch matches native output', () => {
		// Force the fallback path by removing window.CSS.escape, run the
		// same cases, then restore. This exercises the spec-compliant
		// polyfill rather than jsdom's native implementation.
		const original = ( window as unknown as { CSS?: typeof CSS } ).CSS;
		try {
			delete ( window as unknown as { CSS?: typeof CSS } ).CSS;
			for ( const [ input, expected ] of trickyCases ) {
				expect( cssEscape( input ) ).toBe( expected );
			}
		} finally {
			( window as unknown as { CSS?: typeof CSS } ).CSS = original;
		}
	} );
} );

describe( 'getSelector', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'returns #id when the element has one', () => {
		document.body.innerHTML = '<div id="hero"></div>';
		const el = document.getElementById( 'hero' )!;
		expect( getSelector( el ) ).toBe( '#hero' );
	} );

	it( 'escapes ids with special characters', () => {
		document.body.innerHTML = '<div id="weird:id"></div>';
		const el = document.querySelector( '[id="weird:id"]' )!;
		expect( getSelector( el ) ).toMatch( /^#weird/ );
		// Should escape the colon (or use CSS.escape's output).
		expect( getSelector( el ) ).not.toBe( '#weird:id' );
	} );

	it( 'falls back to a path with classes and :nth-of-type when no id', () => {
		document.body.innerHTML =
			'<main class="content"><h1 class="title">A</h1><h1 class="title">B</h1></main>';
		const second = document.querySelectorAll( '.title' )[ 1 ];
		const sel = getSelector( second );
		expect( sel ).toMatch( /h1/ );
		expect( sel ).toMatch( /:nth-of-type\(2\)/ );
	} );

	it( 'strips internal aai-* classes from the selector', () => {
		document.body.innerHTML =
			'<div class="brand-card aai-highlight"><span>x</span></div>';
		const el = document.querySelector( '.brand-card' )!;
		expect( getSelector( el ) ).not.toMatch( /aai-/ );
	} );

	it( 'caps the depth at 5 ancestors', () => {
		document.body.innerHTML =
			'<a><b><c><d><e><f><g><h>x</h></g></f></e></d></c></b></a>';
		const leaf = document.querySelector( 'h' )!;
		const sel = getSelector( leaf );
		// Five segments separated by ' > '.
		expect( sel.split( ' > ' ) ).toHaveLength( 5 );
	} );

	it( 'always disambiguates the leaf with :nth-of-type', () => {
		document.body.innerHTML = '<section><p>Only paragraph</p></section>';
		const p = document.querySelector( 'p' )!;
		expect( getSelector( p ) ).toMatch( /:nth-of-type\(1\)/ );
	} );
} );

describe( 'getComputedStylesFor', () => {
	it( 'returns only the keys the toolbar actually inspects', () => {
		document.body.innerHTML = '<div id="t" style="color: red;">X</div>';
		const el = document.getElementById( 't' )!;
		const styles = getComputedStylesFor( el );
		// Should include color (since we set it) and not include random
		// non-allow-listed properties even if jsdom returns them.
		expect( styles.color ).toBeDefined();
		expect( styles ).not.toHaveProperty( 'will-change' );
	} );
} );

describe( 'getElementText', () => {
	it( 'trims and collapses whitespace', () => {
		document.body.innerHTML =
			'<p>  Hello \n  world\t  </p>';
		const p = document.querySelector( 'p' )!;
		expect( getElementText( p ) ).toBe( 'Hello world' );
	} );

	it( 'truncates to 200 characters', () => {
		document.body.innerHTML = `<p>${ 'a'.repeat( 500 ) }</p>`;
		const p = document.querySelector( 'p' )!;
		expect( getElementText( p ).length ).toBe( 200 );
	} );

	it( 'returns empty string for elements with no text', () => {
		document.body.innerHTML = '<div></div>';
		const div = document.querySelector( 'div' )!;
		expect( getElementText( div ) ).toBe( '' );
	} );
} );

describe( 'generateClientId', () => {
	it( 'starts with the aai_ prefix', () => {
		expect( generateClientId() ).toMatch( /^aai_/ );
	} );

	it( 'produces different ids on consecutive calls', () => {
		const ids = new Set();
		for ( let i = 0; i < 50; i++ ) {
			ids.add( generateClientId() );
		}
		expect( ids.size ).toBe( 50 );
	} );
} );
