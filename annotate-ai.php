<?php
/**
 * Plugin Name: Annotate AI
 * Plugin URI: https://github.com/thomasguillot/annotate-ai
 * Description: Point-and-click design feedback for AI agents. Annotate any element on your WordPress site, submit structured feedback, and let your AI agent action it.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Author: Thomas Guillot
 * Author URI: https://thomasguillot.com
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: annotate-ai
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ANNOTATE_AI_VERSION', '1.0.0' );
define( 'ANNOTATE_AI_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'ANNOTATE_AI_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/**
 * Main plugin class.
 */
final class Annotate_AI {

	const OPTION_METHOD        = 'annotate_ai_method';
	const OPTION_WEBHOOK_URL   = 'annotate_ai_webhook_url';
	const OPTION_WEBHOOK_TOKEN = 'annotate_ai_webhook_token';
	const OPTION_TG_TOKEN      = 'annotate_ai_telegram_token';
	const OPTION_TG_CHAT_ID    = 'annotate_ai_telegram_chat_id';
	const OPTION_ANNOTATIONS   = 'annotate_ai_annotations';

	const MAX_ANNOTATIONS = 500;

	/**
	 * Hook returned by add_management_page, used to gate admin asset enqueue.
	 *
	 * @var string
	 */
	private static $page_hook = '';

	/**
	 * Prevent instantiation.
	 */
	private function __construct() {}

	/**
	 * Initialize the plugin.
	 */
	public static function init(): void {
		add_action( 'init', [ __CLASS__, 'load_textdomain' ] );
		add_action( 'admin_menu', [ __CLASS__, 'add_settings_page' ] );
		add_action( 'admin_enqueue_scripts', [ __CLASS__, 'enqueue_admin' ] );
		add_action( 'wp_enqueue_scripts', [ __CLASS__, 'enqueue_frontend' ] );
		add_action( 'admin_bar_menu', [ __CLASS__, 'add_admin_bar_item' ], 100 );
		add_action( 'rest_api_init', [ __CLASS__, 'register_rest_routes' ] );
	}

	/**
	 * Add the toolbar toggle to the WordPress admin bar (frontend only).
	 *
	 * @param WP_Admin_Bar $wp_admin_bar The admin bar instance.
	 */
	public static function add_admin_bar_item( $wp_admin_bar ): void {
		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) || is_admin() ) {
			return;
		}

		$wp_admin_bar->add_node( [
			'id'    => 'annotate-ai',
			'title' => '<span class="ab-icon" aria-hidden="true"></span><span class="ab-label">' . esc_html__( 'Annotate', 'annotate-ai' ) . '</span>',
			'href'  => '#',
			'meta'  => [
				'title' => __( 'Toggle Annotate AI annotation mode', 'annotate-ai' ),
			],
		] );
	}

	/**
	 * Load the plugin's text domain for translations.
	 */
	public static function load_textdomain(): void {
		load_plugin_textdomain(
			'annotate-ai',
			false,
			dirname( plugin_basename( __FILE__ ) ) . '/languages'
		);
	}

	/**
	 * Add the settings page under Tools.
	 */
	public static function add_settings_page(): void {
		self::$page_hook = (string) add_management_page(
			__( 'Annotate AI', 'annotate-ai' ),
			__( 'Annotate AI', 'annotate-ai' ),
			'manage_options',
			'annotate-ai',
			[ __CLASS__, 'render_settings_page' ]
		);
	}

	/**
	 * Render the settings page container.
	 */
	public static function render_settings_page(): void {
		echo '<div class="wrap"><div id="annotate-ai-root"></div></div>';
	}

	/**
	 * Enqueue admin scripts and styles.
	 *
	 * @param string $hook The current admin page hook.
	 */
	public static function enqueue_admin( string $hook ): void {
		if ( '' === self::$page_hook || $hook !== self::$page_hook ) {
			return;
		}

		$asset_file = ANNOTATE_AI_PLUGIN_DIR . 'build/admin.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: [
				'dependencies' => [ 'wp-element', 'wp-components', 'wp-api-fetch' ],
				'version'      => ANNOTATE_AI_VERSION,
			];

		wp_enqueue_script(
			'annotate-ai-admin',
			ANNOTATE_AI_PLUGIN_URL . 'build/admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_set_script_translations(
			'annotate-ai-admin',
			'annotate-ai',
			ANNOTATE_AI_PLUGIN_DIR . 'languages'
		);

		if ( file_exists( ANNOTATE_AI_PLUGIN_DIR . 'build/style-admin.css' ) ) {
			wp_enqueue_style(
				'annotate-ai-admin',
				ANNOTATE_AI_PLUGIN_URL . 'build/style-admin.css',
				[ 'wp-components' ],
				$asset['version']
			);
		}

		wp_localize_script( 'annotate-ai-admin', 'annotateAiAdmin', [
			'method'        => get_option( self::OPTION_METHOD, 'none' ),
			'webhookUrl'    => get_option( self::OPTION_WEBHOOK_URL, '' ),
			'webhookToken'  => get_option( self::OPTION_WEBHOOK_TOKEN, '' ),
			'telegramToken' => get_option( self::OPTION_TG_TOKEN, '' ),
			'telegramChat'  => get_option( self::OPTION_TG_CHAT_ID, '' ),
			'pullUrl'       => rest_url( 'annotate-ai/v1/annotations?status=open' ),
			'siteUrl'       => home_url(),
		] );
	}

	/**
	 * Enqueue the frontend annotation toolbar.
	 */
	public static function enqueue_frontend(): void {
		if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
			return;
		}

		if ( is_admin() || is_customize_preview() ) {
			return;
		}

		$asset_file = ANNOTATE_AI_PLUGIN_DIR . 'build/frontend.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: [
				'dependencies' => [ 'wp-components', 'wp-element', 'wp-i18n' ],
				'version'      => ANNOTATE_AI_VERSION,
			];

		// Carry the current admin's color scheme onto the frontend so that
		// --wp-admin-theme-color resolves the same way it does in wp-admin.
		// Without this, wp-components falls back to its bundled default blue.
		$color_scheme = get_user_option( 'admin_color' );
		if ( ! $color_scheme ) {
			$color_scheme = 'fresh';
		}
		$admin_colors = isset( $GLOBALS['_wp_admin_css_colors'] ) ? $GLOBALS['_wp_admin_css_colors'] : [];
		if ( isset( $admin_colors[ $color_scheme ]->url ) ) {
			wp_enqueue_style(
				'annotate-ai-admin-colors',
				$admin_colors[ $color_scheme ]->url,
				[],
				$asset['version']
			);
		}

		if ( file_exists( ANNOTATE_AI_PLUGIN_DIR . 'build/style-frontend.css' ) ) {
			wp_enqueue_style(
				'annotate-ai-toolbar',
				ANNOTATE_AI_PLUGIN_URL . 'build/style-frontend.css',
				[ 'wp-components', 'annotate-ai-admin-colors' ],
				$asset['version']
			);
		}

		wp_enqueue_script(
			'annotate-ai-toolbar',
			ANNOTATE_AI_PLUGIN_URL . 'build/frontend.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_set_script_translations(
			'annotate-ai-toolbar',
			'annotate-ai',
			ANNOTATE_AI_PLUGIN_DIR . 'languages'
		);

		$request_uri = '/';
		if ( isset( $_SERVER['REQUEST_URI'] ) ) {
			$request_uri = sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) );
		}
		$page_url = get_permalink();
		if ( ! $page_url ) {
			$page_url = home_url( $request_uri );
		}

		wp_localize_script( 'annotate-ai-toolbar', 'annotateAi', [
			'restUrl'         => rest_url( 'annotate-ai/v1/annotations' ),
			'nonce'           => wp_create_nonce( 'wp_rest' ),
			'pageUrl'         => $page_url,
			'siteUrl'         => home_url(),
			'siteName'        => get_bloginfo( 'name' ),
			'adminBarShowing' => is_admin_bar_showing(),
			'notifyMethod'    => get_option( self::OPTION_METHOD, 'none' ),
			'presets'         => self::get_theme_presets(),
		] );
	}

	/**
	 * Read the active theme's color palette and font sizes from theme.json.
	 *
	 * Theme-defined presets take priority; if absent, we fall back to core
	 * defaults. The returned shape matches what @wordpress/components'
	 * <ColorPalette> and <FontSizePicker> consume.
	 *
	 * @return array{colors: array, fontSizes: array}
	 */
	private static function get_theme_presets(): array {
		$global_settings = function_exists( 'wp_get_global_settings' )
			? wp_get_global_settings()
			: [];

		$colors = [];
		foreach ( [ 'theme', 'default' ] as $origin ) {
			if ( ! empty( $global_settings['color']['palette'][ $origin ] ) ) {
				$colors = $global_settings['color']['palette'][ $origin ];
				break;
			}
		}

		$font_sizes = [];
		foreach ( [ 'theme', 'default' ] as $origin ) {
			if ( ! empty( $global_settings['typography']['fontSizes'][ $origin ] ) ) {
				$font_sizes = $global_settings['typography']['fontSizes'][ $origin ];
				break;
			}
		}

		return [
			'colors'    => array_values( $colors ),
			'fontSizes' => array_values( $font_sizes ),
		];
	}

	/**
	 * Register REST API routes.
	 */
	public static function register_rest_routes(): void {
		$admin_permission = function (): bool {
			return current_user_can( 'manage_options' );
		};

		register_rest_route( 'annotate-ai/v1', '/annotations', [
			[
				'methods'             => 'POST',
				'callback'            => [ __CLASS__, 'create_annotation' ],
				'permission_callback' => $admin_permission,
			],
			[
				'methods'             => 'GET',
				'callback'            => [ __CLASS__, 'list_annotations' ],
				'permission_callback' => $admin_permission,
			],
		] );

		register_rest_route( 'annotate-ai/v1', '/annotations/batch', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'batch_submit' ],
			'permission_callback' => $admin_permission,
		] );

		register_rest_route( 'annotate-ai/v1', '/annotations/(?P<id>[a-zA-Z0-9_-]+)/resolve', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'resolve_annotation' ],
			'permission_callback' => $admin_permission,
		] );

		register_rest_route( 'annotate-ai/v1', '/annotations/(?P<id>[a-zA-Z0-9_-]+)', [
			'methods'             => 'PATCH',
			'callback'            => [ __CLASS__, 'update_annotation' ],
			'permission_callback' => $admin_permission,
		] );

		register_rest_route( 'annotate-ai/v1', '/annotations/resolved', [
			'methods'             => 'DELETE',
			'callback'            => [ __CLASS__, 'clear_resolved' ],
			'permission_callback' => $admin_permission,
		] );

		register_rest_route( 'annotate-ai/v1', '/settings', [
			'methods'             => 'POST',
			'callback'            => [ __CLASS__, 'save_settings' ],
			'permission_callback' => $admin_permission,
		] );
	}

	/**
	 * Save settings.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function save_settings( WP_REST_Request $request ) {
		$params = $request->get_json_params();

		$method = sanitize_text_field( $params['method'] ?? 'none' );
		if ( ! in_array( $method, [ 'none', 'webhook', 'telegram' ], true ) ) {
			$method = 'none';
		}

		$telegram_token = sanitize_text_field( $params['telegram_token'] ?? '' );
		if ( '' !== $telegram_token && ! preg_match( '/^\d+:[A-Za-z0-9_-]+$/', $telegram_token ) ) {
			return new WP_Error(
				'invalid_telegram_token',
				__( 'Invalid Telegram bot token format. Expected "<bot_id>:<secret>".', 'annotate-ai' ),
				[ 'status' => 400 ]
			);
		}

		$telegram_chat = sanitize_text_field( $params['telegram_chat_id'] ?? '' );
		if ( '' !== $telegram_chat && ! preg_match( '/^-?\d+$/', $telegram_chat ) ) {
			return new WP_Error(
				'invalid_telegram_chat',
				__( 'Telegram chat ID must be numeric.', 'annotate-ai' ),
				[ 'status' => 400 ]
			);
		}

		$webhook_url = esc_url_raw( $params['webhook_url'] ?? '' );
		if ( '' !== $webhook_url && ! preg_match( '#^https?://#i', $webhook_url ) ) {
			return new WP_Error(
				'invalid_webhook_url',
				__( 'Webhook URL must start with http:// or https://.', 'annotate-ai' ),
				[ 'status' => 400 ]
			);
		}

		update_option( self::OPTION_METHOD, $method );
		update_option( self::OPTION_WEBHOOK_URL, $webhook_url );
		update_option( self::OPTION_WEBHOOK_TOKEN, sanitize_text_field( $params['webhook_token'] ?? '' ) );
		update_option( self::OPTION_TG_TOKEN, $telegram_token );
		update_option( self::OPTION_TG_CHAT_ID, $telegram_chat );

		return rest_ensure_response( [ 'success' => true ] );
	}

	/**
	 * Create a single annotation.
	 *
	 * Note: get_option/update_option is not atomic. Two parallel writes from
	 * the same admin can lose entries. Acceptable for a single-user QA tool.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public static function create_annotation( WP_REST_Request $request ): WP_REST_Response {
		$params     = $request->get_json_params();
		$annotation = self::build_annotation( is_array( $params ) ? $params : [] );

		$annotations   = get_option( self::OPTION_ANNOTATIONS, [] );
		$annotations[] = $annotation;
		$annotations   = self::cap_annotations( $annotations );
		update_option( self::OPTION_ANNOTATIONS, $annotations, false );

		return rest_ensure_response( [
			'success'    => true,
			'annotation' => $annotation,
		] );
	}

	/**
	 * Batch submit annotations and notify the agent.
	 *
	 * Note: get_option/update_option is not atomic. See create_annotation.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public static function batch_submit( WP_REST_Request $request ): WP_REST_Response {
		$params      = $request->get_json_params();
		$items       = is_array( $params['annotations'] ?? null ) ? $params['annotations'] : [];
		$annotations = get_option( self::OPTION_ANNOTATIONS, [] );
		$batch       = [];

		foreach ( $items as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$annotation    = self::build_annotation( $item );
			$annotations[] = $annotation;
			$batch[]       = $annotation;
		}

		$annotations = self::cap_annotations( $annotations );
		update_option( self::OPTION_ANNOTATIONS, $annotations, false );

		$notified = self::notify_agent( $batch );

		return rest_ensure_response( [
			'success'     => true,
			'count'       => count( $batch ),
			'notified'    => $notified,
			'annotations' => $batch,
		] );
	}

	/**
	 * Trim the annotations array to MAX_ANNOTATIONS, keeping the most recent.
	 *
	 * @param array $annotations Annotations array.
	 * @return array Trimmed array.
	 */
	private static function cap_annotations( array $annotations ): array {
		if ( count( $annotations ) <= self::MAX_ANNOTATIONS ) {
			return $annotations;
		}
		return array_values( array_slice( $annotations, -self::MAX_ANNOTATIONS ) );
	}

	/**
	 * List annotations with optional filters.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response
	 */
	public static function list_annotations( WP_REST_Request $request ): WP_REST_Response {
		$annotations = get_option( self::OPTION_ANNOTATIONS, [] );
		$status      = $request->get_param( 'status' );
		$page_url    = $request->get_param( 'page_url' );

		if ( $status ) {
			$annotations = array_filter( $annotations, function ( array $a ) use ( $status ): bool {
				return ( $a['status'] ?? 'open' ) === $status;
			} );
		}

		if ( $page_url ) {
			$annotations = array_filter( $annotations, function ( array $a ) use ( $page_url ): bool {
				return ( $a['page_url'] ?? '' ) === $page_url;
			} );
		}

		return rest_ensure_response( [
			'count'       => count( $annotations ),
			'annotations' => array_values( $annotations ),
		] );
	}

	/**
	 * Update an annotation's note by ID.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function update_annotation( WP_REST_Request $request ) {
		$id          = $request->get_param( 'id' );
		$params      = $request->get_json_params();
		$annotations = get_option( self::OPTION_ANNOTATIONS, [] );
		$found       = false;

		foreach ( $annotations as &$a ) {
			if ( ( $a['id'] ?? '' ) === $id ) {
				if ( isset( $params['note'] ) ) {
					$a['note'] = sanitize_textarea_field( $params['note'] );
				}
				if ( isset( $params['requested_text'] ) ) {
					$a['requested_text'] = sanitize_textarea_field( $params['requested_text'] );
				}
				if ( isset( $params['requested_changes'] ) ) {
					$a['requested_changes'] = self::sanitize_requested_changes(
						$params['requested_changes']
					);
				}
				if ( isset( $params['status'] ) ) {
					$status = sanitize_text_field( $params['status'] );
					if ( in_array( $status, [ 'open', 'in_progress', 'done', 'verified' ], true ) ) {
						$a['status'] = $status;
						$a[ $status . '_at' ] = current_time( 'c' );
					}
				}
				if ( isset( $params['resolution_note'] ) ) {
					$a['resolution_note'] = sanitize_textarea_field( $params['resolution_note'] );
				}
				if ( isset( $params['changes'] ) ) {
					$a['changes'] = self::sanitize_agent_changes( $params['changes'] );
				}
				if ( isset( $params['breakpoint'] ) ) {
					$bp = sanitize_text_field( $params['breakpoint'] );
					if ( in_array( $bp, [ 'all', 'mobile', 'tablet', 'desktop' ], true ) ) {
						$a['breakpoint'] = $bp;
					}
				}
				$found = true;
				break;
			}
		}

		if ( ! $found ) {
			return new WP_Error( 'not_found', __( 'Annotation not found.', 'annotate-ai' ), [ 'status' => 404 ] );
		}

		update_option( self::OPTION_ANNOTATIONS, $annotations, false );

		return rest_ensure_response( [ 'success' => true ] );
	}

	/**
	 * Resolve an annotation by ID.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function resolve_annotation( WP_REST_Request $request ) {
		$id          = $request->get_param( 'id' );
		$params      = $request->get_json_params();
		$annotations = get_option( self::OPTION_ANNOTATIONS, [] );
		$found       = false;

		foreach ( $annotations as &$a ) {
			if ( ( $a['id'] ?? '' ) === $id ) {
				// Align with the documented open → in_progress → done → verified flow.
				// This endpoint is a legacy alias for "agent finished, awaiting human verification".
				$a['status']          = 'done';
				$a['done_at']         = current_time( 'c' );
				$a['resolution_note'] = sanitize_textarea_field( $params['note'] ?? '' );
				$found                = true;
				break;
			}
		}

		if ( ! $found ) {
			return new WP_Error( 'not_found', __( 'Annotation not found.', 'annotate-ai' ), [ 'status' => 404 ] );
		}

		update_option( self::OPTION_ANNOTATIONS, $annotations, false );

		return rest_ensure_response( [ 'success' => true ] );
	}

	/**
	 * Clear annotations the human has already verified.
	 *
	 * Also drops `resolved` entries from any pre-existing data, since that
	 * was the legacy status prior to the open/in_progress/done/verified flow.
	 *
	 * @return WP_REST_Response
	 */
	public static function clear_resolved(): WP_REST_Response {
		$annotations = get_option( self::OPTION_ANNOTATIONS, [] );
		$annotations = array_filter( $annotations, function ( array $a ): bool {
			$status = $a['status'] ?? 'open';
			return 'verified' !== $status && 'resolved' !== $status;
		} );
		update_option( self::OPTION_ANNOTATIONS, array_values( $annotations ), false );

		return rest_ensure_response( [ 'success' => true ] );
	}

	/**
	 * Notify the configured agent about new annotations.
	 *
	 * @param array $annotations The annotations to send.
	 * @return bool Whether notification was successful.
	 */
	private static function notify_agent( array $annotations ): bool {
		$method = get_option( self::OPTION_METHOD, 'none' );

		if ( 'webhook' === $method ) {
			return self::notify_webhook( $annotations );
		}

		if ( 'telegram' === $method ) {
			return self::notify_telegram( $annotations );
		}

		return false;
	}

	/**
	 * Send annotations via webhook.
	 *
	 * @param array $annotations The annotations to send.
	 * @return bool Whether the webhook was successful.
	 */
	private static function notify_webhook( array $annotations ): bool {
		$url = get_option( self::OPTION_WEBHOOK_URL, '' );
		if ( empty( $url ) ) {
			return false;
		}

		$headers = [ 'Content-Type' => 'application/json' ];

		$token = get_option( self::OPTION_WEBHOOK_TOKEN, '' );
		if ( ! empty( $token ) ) {
			$headers['Authorization'] = 'Bearer ' . $token;
		}

		$response = wp_remote_post( $url, [
			'body'    => wp_json_encode( [
				'site'        => home_url(),
				'site_name'   => get_bloginfo( 'name' ),
				'count'       => count( $annotations ),
				'annotations' => $annotations,
			] ),
			'headers' => $headers,
			'timeout' => 10,
		] );

		return ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) < 400;
	}

	/**
	 * Send annotations via Telegram.
	 *
	 * Uses parse_mode=HTML and esc_html() on every interpolation to neutralise
	 * Markdown/HTML injection from user-supplied notes and selectors. The bot
	 * token is also pattern-validated defensively before being placed in the
	 * URL path.
	 *
	 * @param array $annotations The annotations to send.
	 * @return bool Whether the message was sent.
	 */
	private static function notify_telegram( array $annotations ): bool {
		$token   = (string) get_option( self::OPTION_TG_TOKEN, '' );
		$chat_id = (string) get_option( self::OPTION_TG_CHAT_ID, '' );

		if ( '' === $token || '' === $chat_id ) {
			return false;
		}

		if ( ! preg_match( '/^\d+:[A-Za-z0-9_-]+$/', $token ) ) {
			return false;
		}

		if ( ! preg_match( '/^-?\d+$/', $chat_id ) ) {
			return false;
		}

		$site_name = get_bloginfo( 'name' );
		$site_url  = home_url();
		$count     = count( $annotations );

		$text = sprintf(
			/* translators: 1: number of annotations, 2: site name, 3: site URL, 4: plural suffix */
			"📌 <b>%1\$d new annotation%4\$s</b> on %2\$s\n%3\$s\n\n",
			$count,
			esc_html( $site_name ),
			esc_html( $site_url ),
			$count > 1 ? 's' : ''
		);

		foreach ( $annotations as $i => $a ) {
			$num  = $i + 1;
			$note = esc_html( $a['note'] ?? '' );
			$sel  = esc_html( $a['selector'] ?? '' );
			$text .= "{$num}. <code>{$sel}</code>\n<i>{$note}</i>\n\n";
		}

		$response = wp_remote_post( 'https://api.telegram.org/bot' . $token . '/sendMessage', [
			'body'    => [
				'chat_id'    => $chat_id,
				'text'       => $text,
				'parse_mode' => 'HTML',
			],
			'timeout' => 10,
		] );

		return ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) < 400;
	}

	/**
	 * Build a sanitised annotation from request params.
	 *
	 * The author is always derived server-side from the current user — the
	 * client cannot spoof the `user` field.
	 *
	 * @param array $params Raw annotation parameters.
	 * @return array Sanitised annotation.
	 */
	private static function build_annotation( array $params ): array {
		$current_user = wp_get_current_user();
		$user_name    = $current_user && $current_user->exists()
			? ( $current_user->display_name ?: $current_user->user_login )
			: '';

		$viewport = is_array( $params['viewport'] ?? null ) ? $params['viewport'] : [];

		$breakpoint = sanitize_text_field( $params['breakpoint'] ?? 'all' );
		if ( ! in_array( $breakpoint, [ 'all', 'mobile', 'tablet', 'desktop' ], true ) ) {
			$breakpoint = 'all';
		}

		$annotation = [
			'id'              => wp_generate_uuid4(),
			'status'          => 'open',
			'timestamp'       => current_time( 'c' ),
			'user'            => sanitize_text_field( $user_name ),
			'page_url'        => esc_url_raw( $params['page_url'] ?? '' ),
			'site_name'       => sanitize_text_field( $params['site_name'] ?? '' ),
			'note'            => sanitize_textarea_field( $params['note'] ?? '' ),
			'selector'        => sanitize_text_field( $params['selector'] ?? '' ),
			'element_tag'     => sanitize_text_field( $params['element_tag'] ?? '' ),
			'element_text'    => mb_substr( sanitize_text_field( $params['element_text'] ?? '' ), 0, 200 ),
			'computed_styles' => self::sanitize_styles( $params['computed_styles'] ?? [] ),
			'viewport'        => [
				'width'  => absint( $viewport['width'] ?? 0 ),
				'height' => absint( $viewport['height'] ?? 0 ),
			],
			'breakpoint'      => $breakpoint,
		];

		$requested_changes = self::sanitize_requested_changes( $params['requested_changes'] ?? [] );
		if ( ! empty( $requested_changes ) ) {
			$annotation['requested_changes'] = $requested_changes;
		}

		if ( isset( $params['requested_text'] ) && '' !== $params['requested_text'] ) {
			$annotation['requested_text'] = sanitize_textarea_field( $params['requested_text'] );
		}

		return $annotation;
	}

	/**
	 * Sanitize the user's requested style changes.
	 *
	 * Allow-list mirrors the controls available in the annotation modal.
	 * Each entry is structured as `{value: string, preset?: string}` so the
	 * agent can prefer a theme.json preset slug when one was selected.
	 *
	 * @param mixed $changes Raw input.
	 * @return array Sanitised changes.
	 */
	private static function sanitize_requested_changes( $changes ): array {
		if ( ! is_array( $changes ) ) {
			return [];
		}

		$allowed_keys = [
			'font-size',
			'color',
			'background-color',
		];

		$clean = [];
		foreach ( $allowed_keys as $key ) {
			if ( ! isset( $changes[ $key ] ) ) {
				continue;
			}
			$entry = $changes[ $key ];
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$value = isset( $entry['value'] ) ? sanitize_text_field( (string) $entry['value'] ) : '';
			if ( '' === $value ) {
				continue;
			}
			$out = [ 'value' => $value ];
			if ( ! empty( $entry['preset'] ) ) {
				$out['preset'] = sanitize_key( (string) $entry['preset'] );
			}
			$clean[ $key ] = $out;
		}
		return $clean;
	}

	/**
	 * Sanitize the agent's structured change-log entries.
	 *
	 * Each entry is a free-form bag of metadata describing what the agent
	 * did — file path, property, old/new values. We sanitise all string
	 * fields with sanitize_text_field and ignore everything else.
	 *
	 * @param mixed $changes Raw input.
	 * @return array Sanitised array of change entries.
	 */
	private static function sanitize_agent_changes( $changes ): array {
		if ( ! is_array( $changes ) ) {
			return [];
		}
		$clean = [];
		foreach ( $changes as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$row = [];
			foreach ( [ 'file', 'path', 'property', 'old', 'new', 'note' ] as $key ) {
				if ( isset( $entry[ $key ] ) && is_scalar( $entry[ $key ] ) ) {
					$row[ $key ] = sanitize_text_field( (string) $entry[ $key ] );
				}
			}
			if ( ! empty( $row ) ) {
				$clean[] = $row;
			}
		}
		return $clean;
	}

	/**
	 * Sanitize computed styles from an annotation.
	 *
	 * @param mixed $styles Raw styles.
	 * @return array Sanitised styles.
	 */
	private static function sanitize_styles( $styles ): array {
		if ( ! is_array( $styles ) ) {
			return [];
		}

		$clean        = [];
		$allowed_keys = [
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
		];

		foreach ( $allowed_keys as $key ) {
			if ( isset( $styles[ $key ] ) ) {
				$clean[ $key ] = sanitize_text_field( $styles[ $key ] );
			}
		}

		return $clean;
	}
}

Annotate_AI::init();
