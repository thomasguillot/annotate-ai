/**
 * Annotate AI — Admin Settings Page.
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardBody,
	CardHeader,
	SelectControl,
	TextControl,
	Button,
	Notice,
	Spinner,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { createRoot } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';

import './style.scss';

declare global {
	interface Window {
		annotateAiAdmin: {
			method: string;
			webhookUrl: string;
			webhookToken: string;
			telegramToken: string;
			telegramChat: string;
			pullUrl: string;
			siteUrl: string;
		};
	}
}

interface Annotation {
	id: string;
	status: string;
	timestamp: string;
	user: string;
	page_url: string;
	site_name: string;
	note: string;
	selector: string;
	element_tag: string;
	element_text: string;
	computed_styles: Record< string, string >;
	viewport: { width: number; height: number };
	resolved_at?: string;
	resolution_note?: string;
}

interface AnnotationListResponse {
	count: number;
	annotations: Annotation[];
}

type NoticeStatus = 'success' | 'error' | 'warning' | 'info';
type NotifyMethod = 'none' | 'webhook' | 'telegram';

function AdminPage() {
	const config = window.annotateAiAdmin;

	const [ method, setMethod ] = useState< NotifyMethod >(
		( config.method as NotifyMethod ) || 'none'
	);
	const [ webhookUrl, setWebhookUrl ] = useState( config.webhookUrl || '' );
	const [ webhookToken, setWebhookToken ] = useState(
		config.webhookToken || ''
	);
	const [ telegramToken, setTelegramToken ] = useState(
		config.telegramToken || ''
	);
	const [ telegramChatId, setTelegramChatId ] = useState(
		config.telegramChat || ''
	);
	const [ saving, setSaving ] = useState( false );
	const [ notice, setNotice ] = useState< {
		type: NoticeStatus;
		message: string;
	} | null >( null );
	const [ annotations, setAnnotations ] = useState< Annotation[] >( [] );
	const [ loading, setLoading ] = useState( true );
	const [ copied, setCopied ] = useState< 'url' | 'snippet' | null >( null );

	function copyToClipboard(
		text: string,
		token: 'url' | 'snippet'
	) {
		navigator.clipboard
			.writeText( text )
			.then( () => {
				setCopied( token );
				window.setTimeout( () => setCopied( null ), 2000 );
			} )
			.catch( () => {
				setNotice( {
					type: 'error',
					message: __( 'Failed to copy.', 'annotate-ai' ),
				} );
			} );
	}

	const agentSnippet =
		`This WordPress site has the Annotate AI plugin installed.\n\n` +
		`Pull open annotations: GET ${ config.pullUrl }\n\n` +
		`Each annotation has:\n` +
		`- selector / element_tag / element_text — what was annotated\n` +
		`- computed_styles — full computed-CSS snapshot at annotation time (context)\n` +
		`- requested_changes — structured deltas, each {value, preset?}. Prefer the preset slug (theme.json token) when present.\n` +
		`- requested_text — new text content for text-only elements\n` +
		`- breakpoint — one of "all" | "mobile" | "tablet" | "desktop". If not "all", test the fix at that breakpoint.\n` +
		`- viewport — { width, height } where the user was when annotating\n` +
		`- note — natural-language guidance\n\n` +
		`Mark in_progress when you start (so the user sees it):\n` +
		`PATCH ${ config.siteUrl }/wp-json/annotate-ai/v1/annotations/{id}\n` +
		`Body: {"status": "in_progress"}\n\n` +
		`Mark done with a structured change-log when finished:\n` +
		`PATCH ${ config.siteUrl }/wp-json/annotate-ai/v1/annotations/{id}\n` +
		`Body: {\n` +
		`  "status": "done",\n` +
		`  "resolution_note": "what changed in plain English",\n` +
		`  "changes": [{"file": "theme.json", "path": "...", "old": "...", "new": "..."}]\n` +
		`}`;

	useEffect( () => {
		apiFetch( {
			path: '/annotate-ai/v1/annotations',
		} )
			.then( ( data ) => {
				const list = ( data as AnnotationListResponse ).annotations || [];
				setAnnotations( list );
				setLoading( false );
			} )
			.catch( () => setLoading( false ) );
	}, [] );

	function saveSettings() {
		setSaving( true );
		setNotice( null );

		apiFetch( {
			path: '/annotate-ai/v1/settings',
			method: 'POST',
			data: {
				method,
				webhook_url: webhookUrl,
				webhook_token: webhookToken,
				telegram_token: telegramToken,
				telegram_chat_id: telegramChatId,
			},
		} )
			.then( () => {
				setSaving( false );
				setNotice( {
					type: 'success',
					message: __( 'Settings saved.', 'annotate-ai' ),
				} );
			} )
			.catch( ( err: Error ) => {
				setSaving( false );
				setNotice( {
					type: 'error',
					message:
						err.message || __( 'Failed to save.', 'annotate-ai' ),
				} );
			} );
	}

	function resolveAnnotation( id: string ) {
		apiFetch( {
			path: `/annotate-ai/v1/annotations/${ id }/resolve`,
			method: 'POST',
			data: { note: __( 'Resolved from admin', 'annotate-ai' ) },
		} )
			.then( () => {
				setAnnotations( ( prev ) =>
					prev.map( ( a ) =>
						a.id === id ? { ...a, status: 'resolved' } : a
					)
				);
			} )
			.catch( ( err: Error ) => {
				setNotice( {
					type: 'error',
					message:
						err.message ||
						__( 'Failed to resolve annotation.', 'annotate-ai' ),
				} );
			} );
	}

	function clearResolved() {
		apiFetch( {
			path: '/annotate-ai/v1/annotations/resolved',
			method: 'DELETE',
		} )
			.then( () => {
				setAnnotations( ( prev ) =>
					prev.filter( ( a ) => a.status !== 'resolved' )
				);
			} )
			.catch( ( err: Error ) => {
				setNotice( {
					type: 'error',
					message:
						err.message ||
						__(
							'Failed to clear resolved annotations.',
							'annotate-ai'
						),
				} );
			} );
	}

	const openCount = annotations.filter( ( a ) => a.status === 'open' ).length;
	const resolvedCount = annotations.filter(
		( a ) => a.status === 'resolved'
	).length;

	return (
		<div className="annotate-ai-admin">
			<h1>{ __( 'Annotate AI', 'annotate-ai' ) }</h1>

			{ notice && (
				<Notice
					status={ notice.type }
					isDismissible
					onDismiss={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<VStack spacing={ 6 }>
				<Card className="annotate-ai-card">
					<CardHeader>
						<h2>{ __( 'Agent Connection', 'annotate-ai' ) }</h2>
					</CardHeader>
					<CardBody>
						<VStack spacing={ 4 }>
							<SelectControl
								__nextHasNoMarginBottom
								label={ __(
									'Notification method',
									'annotate-ai'
								) }
								help={ __(
									'How should the agent be notified when annotations are submitted?',
									'annotate-ai'
								) }
								value={ method }
								options={ [
									{
										label: __(
											'None (agent pulls via REST API)',
											'annotate-ai'
										),
										value: 'none',
									},
									{
										label: __(
											'Webhook URL',
											'annotate-ai'
										),
										value: 'webhook',
									},
									{
										label: __( 'Telegram', 'annotate-ai' ),
										value: 'telegram',
									},
								] }
								onChange={ setMethod }
							/>

							{ method === 'none' && (
								<VStack spacing={ 3 }>
									<p style={ { margin: 0 } }>
										{ __(
											'Your agent should poll this URL on its own schedule:',
											'annotate-ai'
										) }
									</p>
									<code className="aai-pull-url">
										{ config.pullUrl }
									</code>
									<HStack
										justify="flex-start"
										spacing={ 2 }
									>
										<Button
											variant="secondary"
											size="small"
											onClick={ () =>
												copyToClipboard(
													config.pullUrl,
													'url'
												)
											}
										>
											{ copied === 'url'
												? __( 'Copied', 'annotate-ai' )
												: __(
														'Copy URL',
														'annotate-ai'
												  ) }
										</Button>
										<Button
											variant="secondary"
											size="small"
											onClick={ () =>
												copyToClipboard(
													agentSnippet,
													'snippet'
												)
											}
										>
											{ copied === 'snippet'
												? __( 'Copied', 'annotate-ai' )
												: __(
														'Copy agent snippet',
														'annotate-ai'
												  ) }
										</Button>
									</HStack>
								</VStack>
							) }

							{ method === 'webhook' && (
								<>
									<TextControl
										__nextHasNoMarginBottom
										label={ __(
											'Webhook URL',
											'annotate-ai'
										) }
										help={ __(
											'Annotations will be POSTed here as JSON when submitted.',
											'annotate-ai'
										) }
										value={ webhookUrl }
										onChange={ setWebhookUrl }
										type="url"
									/>
									<TextControl
										__nextHasNoMarginBottom
										label={ __(
											'Bearer Token',
											'annotate-ai'
										) }
										help={ __(
											'Optional. Sent as Authorization: Bearer <token> header.',
											'annotate-ai'
										) }
										value={ webhookToken }
										onChange={ setWebhookToken }
									/>
								</>
							) }

							{ method === 'telegram' && (
								<>
									<TextControl
										__nextHasNoMarginBottom
										label={ __(
											'Bot Token',
											'annotate-ai'
										) }
										help={ __(
											'Telegram bot token (from @BotFather).',
											'annotate-ai'
										) }
										value={ telegramToken }
										onChange={ setTelegramToken }
									/>
									<TextControl
										__nextHasNoMarginBottom
										label={ __( 'Chat ID', 'annotate-ai' ) }
										help={ __(
											'Telegram chat ID where annotations should be sent.',
											'annotate-ai'
										) }
										value={ telegramChatId }
										onChange={ setTelegramChatId }
									/>
								</>
							) }

							<HStack justify="flex-end">
								<Button
									variant="primary"
									onClick={ saveSettings }
									isBusy={ saving }
									disabled={ saving }
								>
									{ saving
										? __( 'Saving…', 'annotate-ai' )
										: __( 'Save Settings', 'annotate-ai' ) }
								</Button>
							</HStack>
						</VStack>
					</CardBody>
				</Card>

				<Card className="annotate-ai-card">
					<CardHeader>
						<h2>
							{ sprintf(
								/* translators: 1: open annotation count, 2: resolved annotation count. */
								__(
									'Annotations (%1$d open, %2$d resolved)',
									'annotate-ai'
								),
								openCount,
								resolvedCount
							) }
						</h2>
					</CardHeader>
					<CardBody>
						{ loading && (
							<p>
								<Spinner />
								<span className="screen-reader-text">
									{ __(
										'Loading annotations…',
										'annotate-ai'
									) }
								</span>
							</p>
						) }

						{ ! loading && annotations.length === 0 && (
							<p>
								{ __(
									'No annotations yet. Browse the frontend and use the annotation toolbar to start.',
									'annotate-ai'
								) }
							</p>
						) }

						{ ! loading && annotations.length > 0 && (
							<>
								<table className="widefat striped">
									<thead>
										<tr>
											<th>
												{ __(
													'Status',
													'annotate-ai'
												) }
											</th>
											<th>
												{ __( 'Page', 'annotate-ai' ) }
											</th>
											<th>
												{ __(
													'Element',
													'annotate-ai'
												) }
											</th>
											<th>
												{ __( 'Note', 'annotate-ai' ) }
											</th>
											<th>
												{ __(
													'Author',
													'annotate-ai'
												) }
											</th>
											<th>
												{ __(
													'Actions',
													'annotate-ai'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ annotations
											.slice()
											.reverse()
											.map( ( a ) => {
												let pagePath = '/';
												try {
													pagePath = new URL(
														a.page_url
													).pathname;
												} catch {
													// Use default.
												}
												return (
													<tr key={ a.id }>
														<td>
															<span
																className="annotate-ai-status"
																data-status={
																	a.status
																}
															>
																{ a.status }
															</span>
														</td>
														<td>{ pagePath }</td>
														<td>
															<code
																title={
																	a.selector
																}
															>
																{ (
																	a.selector ||
																	''
																).length > 50
																	? `${ (
																			a.selector ||
																			''
																	  ).substring(
																			0,
																			50
																	  ) }…`
																	: a.selector }
															</code>
														</td>
														<td>{ a.note }</td>
														<td>{ a.user }</td>
														<td>
															{ a.status ===
																'open' && (
																<Button
																	variant="secondary"
																	size="small"
																	onClick={ () =>
																		resolveAnnotation(
																			a.id
																		)
																	}
																	aria-label={ sprintf(
																		/* translators: %s: annotation note text. */
																		__(
																			'Resolve annotation: %s',
																			'annotate-ai'
																		),
																		a.note
																	) }
																>
																	{ __(
																		'Resolve',
																		'annotate-ai'
																	) }
																</Button>
															) }
														</td>
													</tr>
												);
											} ) }
									</tbody>
								</table>
								{ resolvedCount > 0 && (
									<HStack justify="flex-end">
										<Button
											variant="secondary"
											isDestructive
											onClick={ clearResolved }
										>
											{ __(
												'Clear Resolved',
												'annotate-ai'
											) }
										</Button>
									</HStack>
								) }
							</>
						) }
					</CardBody>
				</Card>
			</VStack>
		</div>
	);
}

document.addEventListener( 'DOMContentLoaded', () => {
	const root = document.getElementById( 'annotate-ai-root' );
	if ( root ) {
		createRoot( root ).render( <AdminPage /> );
	}
} );
