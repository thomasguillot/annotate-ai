<?php
/**
 * Tests for the plugin's sanitisation helpers and `build_annotation`.
 *
 * The methods under test are private statics on the `Annotate_AI` class.
 * We use Reflection to invoke them directly rather than going through the
 * REST surface — these tests focus on the data-shape contract, not the HTTP
 * layer.
 */

use PHPUnit\Framework\TestCase;

final class SanitizationTest extends TestCase {

	/**
	 * Invoke a private static method on Annotate_AI.
	 *
	 * @param string $method Method name.
	 * @param array  $args   Positional arguments.
	 * @return mixed
	 */
	private function call( string $method, array $args = [] ) {
		$ref = new ReflectionMethod( 'Annotate_AI', $method );
		// composer.json allows PHP 7.4+. Reflection requires setAccessible(true)
		// to invoke private methods on PHP 7.4 / 8.0; on 8.1+ private members
		// are already accessible and the call became a no-op (and finally got
		// deprecated on 8.5).
		if ( PHP_VERSION_ID < 80100 ) {
			$ref->setAccessible( true );
		}
		return $ref->invoke( null, ...$args );
	}

	// ──────────────────────────────────────────────────────────────────
	// sanitize_requested_changes
	// ──────────────────────────────────────────────────────────────────

	public function test_requested_changes_keeps_allowed_keys() {
		$result = $this->call( 'sanitize_requested_changes', [
			[
				'font-size'        => [ 'value' => '24px' ],
				'color'            => [ 'value' => '#1a1a1a' ],
				'background-color' => [ 'value' => '#fff' ],
			],
		] );
		$this->assertEquals( '24px', $result['font-size']['value'] );
		$this->assertEquals( '#1a1a1a', $result['color']['value'] );
		$this->assertEquals( '#fff', $result['background-color']['value'] );
	}

	public function test_requested_changes_drops_unknown_keys() {
		$result = $this->call( 'sanitize_requested_changes', [
			[
				'font-size'  => [ 'value' => '24px' ],
				'evil-style' => [ 'value' => 'expression(alert(1))' ],
			],
		] );
		$this->assertArrayHasKey( 'font-size', $result );
		$this->assertArrayNotHasKey( 'evil-style', $result );
	}

	public function test_requested_changes_includes_preset_when_provided() {
		$result = $this->call( 'sanitize_requested_changes', [
			[
				'font-size' => [ 'value' => '24px', 'preset' => 'x-large' ],
				'color'     => [ 'value' => '#1a1a1a' ],
			],
		] );
		$this->assertSame( 'x-large', $result['font-size']['preset'] );
		$this->assertArrayNotHasKey( 'preset', $result['color'] );
	}

	public function test_requested_changes_drops_empty_value() {
		$result = $this->call( 'sanitize_requested_changes', [
			[ 'font-size' => [ 'value' => '' ] ],
		] );
		$this->assertEmpty( $result );
	}

	public function test_requested_changes_drops_non_array_entries() {
		$result = $this->call( 'sanitize_requested_changes', [
			[
				'font-size' => '24px', // not an array, should be ignored
				'color'     => [ 'value' => '#fff' ],
			],
		] );
		$this->assertArrayNotHasKey( 'font-size', $result );
		$this->assertArrayHasKey( 'color', $result );
	}

	public function test_requested_changes_handles_non_array_input() {
		$this->assertEquals( [], $this->call( 'sanitize_requested_changes', [ 'not an array' ] ) );
		$this->assertEquals( [], $this->call( 'sanitize_requested_changes', [ null ] ) );
		$this->assertEquals( [], $this->call( 'sanitize_requested_changes', [ 42 ] ) );
	}

	public function test_requested_changes_sanitizes_preset_to_slug() {
		// Slugs are lowercased and stripped of unsafe chars by sanitize_key.
		$result = $this->call( 'sanitize_requested_changes', [
			[ 'color' => [ 'value' => '#fff', 'preset' => 'My Slug!' ] ],
		] );
		$this->assertSame( 'myslug', $result['color']['preset'] );
	}

	// ──────────────────────────────────────────────────────────────────
	// sanitize_agent_changes
	// ──────────────────────────────────────────────────────────────────

	public function test_agent_changes_keeps_allowed_keys() {
		$result = $this->call( 'sanitize_agent_changes', [
			[
				[
					'file' => 'theme.json',
					'path' => 'styles.elements.h2.typography.fontSize',
					'old'  => '18px',
					'new'  => '24px',
					'note' => 'reason',
				],
			],
		] );
		$this->assertCount( 1, $result );
		$this->assertSame( 'theme.json', $result[0]['file'] );
		$this->assertSame( '24px', $result[0]['new'] );
	}

	public function test_agent_changes_drops_unknown_keys() {
		$result = $this->call( 'sanitize_agent_changes', [
			[
				[
					'file'      => 'theme.json',
					'malicious' => 'rm -rf /',
				],
			],
		] );
		$this->assertArrayHasKey( 'file', $result[0] );
		$this->assertArrayNotHasKey( 'malicious', $result[0] );
	}

	public function test_agent_changes_drops_non_array_entries() {
		$result = $this->call( 'sanitize_agent_changes', [
			[
				'a string entry',
				[ 'file' => 'theme.json' ],
				42,
			],
		] );
		$this->assertCount( 1, $result );
	}

	public function test_agent_changes_drops_empty_rows() {
		$result = $this->call( 'sanitize_agent_changes', [
			[
				[ 'unknown' => 'value' ], // every key is dropped → empty row
				[ 'file' => 'a.json' ],
			],
		] );
		$this->assertCount( 1, $result );
		$this->assertSame( 'a.json', $result[0]['file'] );
	}

	public function test_agent_changes_drops_non_scalar_values() {
		$result = $this->call( 'sanitize_agent_changes', [
			[
				[
					'file' => [ 'oops', 'array' ],
					'old'  => '18px',
				],
			],
		] );
		$this->assertArrayNotHasKey( 'file', $result[0] );
		$this->assertArrayHasKey( 'old', $result[0] );
	}

	// ──────────────────────────────────────────────────────────────────
	// sanitize_styles
	// ──────────────────────────────────────────────────────────────────

	public function test_styles_keeps_allowed_keys() {
		$result = $this->call( 'sanitize_styles', [
			[
				'font-size'        => '18px',
				'color'            => 'rgb(0,0,0)',
				'background-color' => 'transparent',
				'padding'          => '12px 16px',
				'unknown-css'      => 'value',
			],
		] );
		$this->assertArrayHasKey( 'font-size', $result );
		$this->assertArrayHasKey( 'color', $result );
		$this->assertArrayHasKey( 'background-color', $result );
		$this->assertArrayHasKey( 'padding', $result );
		$this->assertArrayNotHasKey( 'unknown-css', $result );
	}

	public function test_styles_handles_non_array() {
		$this->assertEquals( [], $this->call( 'sanitize_styles', [ null ] ) );
		$this->assertEquals( [], $this->call( 'sanitize_styles', [ 'a string' ] ) );
	}

	// ──────────────────────────────────────────────────────────────────
	// build_annotation
	// ──────────────────────────────────────────────────────────────────

	public function test_build_annotation_assigns_open_status_and_id() {
		$result = $this->call( 'build_annotation', [
			[ 'selector' => 'h1', 'note' => 'test' ],
		] );
		$this->assertSame( 'open', $result['status'] );
		$this->assertNotEmpty( $result['id'] );
	}

	public function test_build_annotation_derives_user_server_side() {
		$result = $this->call( 'build_annotation', [
			[
				'selector' => 'h1',
				'user'     => 'attacker-supplied-name', // should be ignored
			],
		] );
		// Stubbed wp_get_current_user returns Test_Stub_WP_User → "Test Admin".
		$this->assertSame( 'Test Admin', $result['user'] );
	}

	public function test_build_annotation_truncates_element_text() {
		$long = str_repeat( 'a', 500 );
		$result = $this->call( 'build_annotation', [
			[ 'selector' => 'p', 'element_text' => $long ],
		] );
		// strlen() is fine here because the input is ASCII; using mb_strlen
		// would require the mbstring extension which isn't guaranteed in
		// every PHPUnit environment.
		$this->assertSame( 200, strlen( $result['element_text'] ) );
	}

	public function test_build_annotation_normalises_breakpoint() {
		$valid = $this->call( 'build_annotation', [
			[ 'selector' => 'h1', 'breakpoint' => 'mobile' ],
		] );
		$this->assertSame( 'mobile', $valid['breakpoint'] );

		$invalid = $this->call( 'build_annotation', [
			[ 'selector' => 'h1', 'breakpoint' => 'phone' ],
		] );
		$this->assertSame( 'all', $invalid['breakpoint'] );

		$absent = $this->call( 'build_annotation', [
			[ 'selector' => 'h1' ],
		] );
		$this->assertSame( 'all', $absent['breakpoint'] );
	}

	public function test_build_annotation_attaches_requested_changes_when_set() {
		$result = $this->call( 'build_annotation', [
			[
				'selector'          => 'h1',
				'requested_changes' => [
					'font-size' => [ 'value' => '24px', 'preset' => 'x-large' ],
				],
			],
		] );
		$this->assertArrayHasKey( 'requested_changes', $result );
		$this->assertSame( '24px', $result['requested_changes']['font-size']['value'] );
	}

	public function test_build_annotation_omits_requested_changes_when_empty() {
		$result = $this->call( 'build_annotation', [
			[ 'selector' => 'h1' ],
		] );
		$this->assertArrayNotHasKey( 'requested_changes', $result );
	}

	public function test_build_annotation_includes_requested_text_only_when_set() {
		$with = $this->call( 'build_annotation', [
			[ 'selector' => 'h1', 'requested_text' => 'Hello' ],
		] );
		$this->assertArrayHasKey( 'requested_text', $with );
		$this->assertSame( 'Hello', $with['requested_text'] );

		$without = $this->call( 'build_annotation', [
			[ 'selector' => 'h1' ],
		] );
		$this->assertArrayNotHasKey( 'requested_text', $without );
	}

	public function test_build_annotation_normalises_viewport_to_ints() {
		$result = $this->call( 'build_annotation', [
			[
				'selector' => 'h1',
				'viewport' => [ 'width' => '-100', 'height' => 'abc' ],
			],
		] );
		$this->assertSame( 100, $result['viewport']['width'] );
		$this->assertSame( 0, $result['viewport']['height'] );
	}

	// ──────────────────────────────────────────────────────────────────
	// cap_annotations
	// ──────────────────────────────────────────────────────────────────

	public function test_cap_annotations_returns_unchanged_when_under_cap() {
		$list = array_fill( 0, 10, [ 'id' => 'x' ] );
		$result = $this->call( 'cap_annotations', [ $list ] );
		$this->assertCount( 10, $result );
	}

	public function test_cap_annotations_keeps_most_recent_when_over_cap() {
		// MAX_ANNOTATIONS = 500; build 502 with id = index, expect last 500.
		$list = [];
		for ( $i = 0; $i < 502; $i++ ) {
			$list[] = [ 'id' => $i ];
		}
		$result = $this->call( 'cap_annotations', [ $list ] );
		$this->assertCount( 500, $result );
		$this->assertSame( 2, $result[0]['id'] );
		$this->assertSame( 501, $result[499]['id'] );
	}
}
