/**
 * Annotate AI — frontend toolbar (React + @wordpress/components).
 *
 * Admin-only (gated by `manage_options` server-side). Annotations are
 * batched in component state and submitted via a single REST call.
 */

import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	generateClientId,
	getComputedStylesFor,
	getElementText,
	getSelector,
} from './utils';
import {
	BaseControl,
	Button,
	ColorPalette,
	Dropdown,
	FontSizePicker,
	Modal,
	Notice,
	SelectControl,
	Snackbar,
	TextControl,
	TextareaControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

interface FontSizePreset {
	name?: string;
	slug: string;
	size: string | number;
}

interface ColorPreset {
	name?: string;
	slug: string;
	color: string;
}

declare global {
	interface Window {
		annotateAi?: {
			restUrl: string;
			nonce: string;
			pageUrl: string;
			siteUrl: string;
			siteName: string;
			adminBarShowing: boolean;
			notifyMethod: 'none' | 'webhook' | 'telegram';
			presets: {
				colors: ColorPreset[];
				fontSizes: FontSizePreset[];
			};
		};
	}
}

interface TargetData {
	selector: string;
	tag: string;
	text: string;
	isTextOnly: boolean;
	styles: Record< string, string >;
	rect: { left: number; top: number };
}

interface ChangeValue {
	value: string;
	preset?: string;
}

interface RequestedChanges {
	'font-size'?: ChangeValue;
	color?: ChangeValue;
	'background-color'?: ChangeValue;
}

type AnnotationStatus = 'open' | 'in_progress' | 'done' | 'verified';
type Breakpoint = 'all' | 'mobile' | 'tablet' | 'desktop';

interface AgentChange {
	file?: string;
	path?: string;
	property?: string;
	old?: string;
	new?: string;
	note?: string;
}

interface Annotation {
	clientId: string;
	// Server-side ID, set after a successful save in "none" mode or when
	// hydrated from the server on page load.
	serverId?: string;
	status: AnnotationStatus;
	note: string;
	selector: string;
	element_tag: string;
	element_text: string;
	isTextOnly: boolean;
	requested_text?: string;
	computed_styles: Record< string, string >;
	requested_changes: RequestedChanges;
	page_url: string;
	site_name: string;
	viewport: { width: number; height: number };
	breakpoint: Breakpoint;
	// Agent-side resolution data (set when status === 'done').
	resolution_note?: string;
	changes?: AgentChange[];
}

interface Toast {
	message: string;
}

function isOurUI( el: EventTarget | null ): boolean {
	if ( ! ( el instanceof Element ) ) {
		return false;
	}
	return Boolean(
		el.closest(
			'#aai-root, #wpadminbar, .aai-pin, .aai-submit-all, .components-modal__frame, .components-snackbar, .components-popover'
		)
	);
}

interface AnnotationModalProps {
	titleText: string;
	selector: string;
	currentText: string;
	isTextOnly: boolean;
	currentStyles: Record< string, string >;
	presets: { colors: ColorPreset[]; fontSizes: FontSizePreset[] };
	initialNote?: string;
	initialRequestedText?: string;
	initialRequestedChanges?: RequestedChanges;
	initialBreakpoint?: Breakpoint;
	primaryLabel: string;
	onSubmit: ( payload: {
		note: string;
		requestedText?: string;
		requestedChanges: RequestedChanges;
		breakpoint: Breakpoint;
	} ) => void;
	onClose: () => void;
}

interface ColorFieldProps {
	label: string;
	value: ChangeValue;
	palette: ColorPreset[];
	onChange: ( value: ChangeValue ) => void;
}

function ColorField( { label, value, palette, onChange }: ColorFieldProps ) {
	const presetName =
		value.preset &&
		palette.find( ( p ) => p.slug === value.preset )?.name;
	const displayLabel =
		presetName ||
		value.value ||
		__( 'transparent', 'annotate-ai' );

	// ColorPalette expects {name, color} entries (no slug). Strip our slug for
	// the picker, then look it back up by index in the onChange callback.
	const paletteForPicker = palette.map( ( p ) => ( {
		name: p.name || p.slug,
		color: p.color,
	} ) );

	return (
		<div className="aai-color-field">
			<BaseControl.VisualLabel>{ label }</BaseControl.VisualLabel>
			<Dropdown
				popoverProps={ { placement: 'bottom-start' } }
				renderToggle={ ( { isOpen, onToggle } ) => (
					<Button
						variant="secondary"
						onClick={ onToggle }
						aria-expanded={ isOpen }
						className="aai-color-toggle"
					>
						<span
							className="aai-color-swatch"
							style={ {
								background: value.value || 'transparent',
							} }
							aria-hidden="true"
						/>
						<span>{ displayLabel }</span>
					</Button>
				) }
				renderContent={ () => (
					<ColorPalette
						colors={ paletteForPicker }
						value={ value.value }
						onChange={ ( newColor, index ) => {
							const slug =
								typeof index === 'number' && palette[ index ]
									? palette[ index ].slug
									: undefined;
							onChange( {
								value: newColor || '',
								preset: slug,
							} );
						} }
						enableAlpha
					/>
				) }
			/>
		</div>
	);
}

function AnnotationModal( {
	titleText,
	selector,
	currentText,
	isTextOnly,
	currentStyles,
	presets,
	initialNote = '',
	initialRequestedText,
	initialRequestedChanges = {},
	initialBreakpoint = 'all',
	primaryLabel,
	onSubmit,
	onClose,
}: AnnotationModalProps ) {
	const initialFontSize: ChangeValue = initialRequestedChanges[ 'font-size' ] ?? {
		value: currentStyles[ 'font-size' ] ?? '',
	};
	const initialColor: ChangeValue = initialRequestedChanges.color ?? {
		value: currentStyles.color ?? '',
	};
	const initialBg: ChangeValue = initialRequestedChanges[ 'background-color' ] ?? {
		value: currentStyles[ 'background-color' ] ?? '',
	};

	const [ text, setText ] = useState( initialRequestedText ?? currentText );
	const [ fontSize, setFontSize ] = useState< ChangeValue >( initialFontSize );
	const [ color, setColor ] = useState< ChangeValue >( initialColor );
	const [ backgroundColor, setBackgroundColor ] =
		useState< ChangeValue >( initialBg );
	const [ note, setNote ] = useState( initialNote );
	const [ breakpoint, setBreakpoint ] =
		useState< Breakpoint >( initialBreakpoint );
	const [ error, setError ] = useState( '' );

	function buildPayload() {
		const requested_changes: RequestedChanges = {};
		const baseFontSize = currentStyles[ 'font-size' ] ?? '';
		const baseColor = currentStyles.color ?? '';
		const baseBg = currentStyles[ 'background-color' ] ?? '';

		if ( fontSize.value && fontSize.value !== baseFontSize ) {
			requested_changes[ 'font-size' ] = fontSize.preset
				? { value: fontSize.value, preset: fontSize.preset }
				: { value: fontSize.value };
		}
		if ( color.value && color.value !== baseColor ) {
			requested_changes.color = color.preset
				? { value: color.value, preset: color.preset }
				: { value: color.value };
		}
		if ( backgroundColor.value && backgroundColor.value !== baseBg ) {
			requested_changes[ 'background-color' ] = backgroundColor.preset
				? {
						value: backgroundColor.value,
						preset: backgroundColor.preset,
				  }
				: { value: backgroundColor.value };
		}
		const requestedText =
			isTextOnly && text !== currentText ? text : undefined;
		const trimmedNote = note.trim();
		return {
			note: trimmedNote,
			requestedText,
			requestedChanges: requested_changes,
			breakpoint,
		};
	}

	function handlePrimary() {
		const payload = buildPayload();
		const hasChanges =
			Object.keys( payload.requestedChanges ).length > 0 ||
			payload.requestedText !== undefined;
		if ( ! hasChanges && ! payload.note ) {
			setError(
				__(
					'Change at least one value or add a note.',
					'annotate-ai'
				)
			);
			return;
		}
		onSubmit( payload );
	}

	return (
		<Modal
			title={ titleText }
			onRequestClose={ onClose }
			className="aai-modal"
			size="medium"
			isDismissible={ false }
		>
			<VStack spacing={ 4 }>
				<p className="aai-form-selector">
					<span className="aai-sr-only">
						{ __( 'Selected element:', 'annotate-ai' ) }{ ' ' }
					</span>
					{ selector }
				</p>

				{ isTextOnly && (
					<TextControl
						__nextHasNoMarginBottom
						label={ __( 'Text', 'annotate-ai' ) }
						value={ text }
						onChange={ setText }
					/>
				) }

				<FontSizePicker
					__next40pxDefaultSize
					fontSizes={ presets.fontSizes }
					value={ fontSize.value }
					onChange={ ( newValue, selectedItem ) => {
						const v =
							newValue === undefined
								? ''
								: String( newValue );
						setFontSize( {
							value: v,
							preset: selectedItem?.slug,
						} );
					} }
				/>

				<ColorField
					label={ __( 'Text color', 'annotate-ai' ) }
					value={ color }
					palette={ presets.colors }
					onChange={ setColor }
				/>
				<ColorField
					label={ __( 'Background', 'annotate-ai' ) }
					value={ backgroundColor }
					palette={ presets.colors }
					onChange={ setBackgroundColor }
				/>

				<SelectControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={ __( 'Affects', 'annotate-ai' ) }
					help={ __(
						'Pick a breakpoint if this issue is specific to one viewport.',
						'annotate-ai'
					) }
					value={ breakpoint }
					options={ [
						{
							label: __( 'All breakpoints', 'annotate-ai' ),
							value: 'all',
						},
						{
							label: __( 'Mobile only', 'annotate-ai' ),
							value: 'mobile',
						},
						{
							label: __( 'Tablet only', 'annotate-ai' ),
							value: 'tablet',
						},
						{
							label: __( 'Desktop only', 'annotate-ai' ),
							value: 'desktop',
						},
					] }
					onChange={ ( v ) => setBreakpoint( v as Breakpoint ) }
				/>

				<TextareaControl
					__nextHasNoMarginBottom
					label={ __( 'Notes', 'annotate-ai' ) }
					help={ __(
						'Anything that doesn’t fit above.',
						'annotate-ai'
					) }
					value={ note }
					onChange={ ( value ) => {
						setNote( value );
						if ( error && value.trim() ) {
							setError( '' );
						}
					} }
					placeholder={ __(
						'e.g. move this above the hero, hide on mobile',
						'annotate-ai'
					) }
					rows={ 3 }
				/>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				<HStack justify="flex-end" spacing={ 2 }>
					<Button variant="tertiary" onClick={ onClose }>
						{ __( 'Cancel', 'annotate-ai' ) }
					</Button>
					<Button variant="primary" onClick={ handlePrimary }>
						{ primaryLabel }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}

interface ReviewModalProps {
	annotation: Annotation;
	onVerify: () => void;
	onReopen: () => void;
	onClose: () => void;
}

function ReviewModal( {
	annotation,
	onVerify,
	onReopen,
	onClose,
}: ReviewModalProps ) {
	const requestedEntries = Object.entries( annotation.requested_changes );
	const hasRequest =
		requestedEntries.length > 0 ||
		annotation.requested_text !== undefined ||
		annotation.note !== '';

	return (
		<Modal
			title={ __( 'Review change', 'annotate-ai' ) }
			onRequestClose={ onClose }
			className="aai-modal aai-review-modal"
			size="medium"
			isDismissible={ false }
		>
			<VStack spacing={ 4 }>
				<p className="aai-form-selector">
					<span className="aai-sr-only">
						{ __( 'Selected element:', 'annotate-ai' ) }{ ' ' }
					</span>
					{ annotation.selector }
				</p>

				{ hasRequest && (
					<div>
						<BaseControl.VisualLabel>
							{ __( 'You asked for', 'annotate-ai' ) }
						</BaseControl.VisualLabel>
						<ul className="aai-review-list">
							{ annotation.requested_text !== undefined && (
								<li>
									<strong>
										{ __( 'Text', 'annotate-ai' ) }:{ ' ' }
									</strong>
									{ annotation.requested_text }
								</li>
							) }
							{ requestedEntries.map( ( [ key, val ] ) => (
								<li key={ key }>
									<strong>{ key }: </strong>
									{ val.preset
										? `${ val.preset } (${ val.value })`
										: val.value }
								</li>
							) ) }
							{ annotation.note && (
								<li>
									<strong>
										{ __( 'Note', 'annotate-ai' ) }:{ ' ' }
									</strong>
									{ annotation.note }
								</li>
							) }
						</ul>
					</div>
				) }

				<div>
					<BaseControl.VisualLabel>
						{ __( 'What the agent did', 'annotate-ai' ) }
					</BaseControl.VisualLabel>
					{ annotation.resolution_note ? (
						<p className="aai-review-resolution">
							{ annotation.resolution_note }
						</p>
					) : (
						<p className="aai-review-resolution aai-review-resolution--empty">
							{ __(
								'The agent did not leave a summary.',
								'annotate-ai'
							) }
						</p>
					) }
					{ annotation.changes && annotation.changes.length > 0 && (
						<ul className="aai-review-list">
							{ annotation.changes.map( ( c, i ) => (
								<li key={ i }>
									{ c.path || c.property || c.file }
									{ c.old !== undefined &&
									c.new !== undefined
										? `: ${ c.old } → ${ c.new }`
										: '' }
								</li>
							) ) }
						</ul>
					) }
				</div>

				<HStack justify="flex-end" spacing={ 2 }>
					<Button variant="tertiary" onClick={ onReopen }>
						{ __( 'Not quite', 'annotate-ai' ) }
					</Button>
					<Button variant="primary" onClick={ onVerify }>
						{ __( 'Looks good', 'annotate-ai' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}

function ToastView( {
	toast,
	onDismiss,
}: {
	toast: Toast;
	onDismiss: () => void;
} ) {
	useEffect( () => {
		const t = window.setTimeout( onDismiss, 2700 );
		return () => window.clearTimeout( t );
	}, [ toast, onDismiss ] );

	return (
		<div className="aai-snackbar-region">
			<Snackbar onDismiss={ onDismiss }>{ toast.message }</Snackbar>
		</div>
	);
}

export default function Toolbar() {
	const config = window.annotateAi;
	const [ isActive, setIsActive ] = useState( false );
	const [ annotations, setAnnotations ] = useState< Annotation[] >( [] );
	const [ pinPositions, setPinPositions ] = useState<
		Record< string, { left: number; top: number } >
	>( {} );
	const [ reviewIndex, setReviewIndex ] = useState< number | null >( null );
	const [ addTarget, setAddTarget ] = useState< TargetData | null >( null );
	const [ editIndex, setEditIndex ] = useState< number | null >( null );
	const [ toast, setToast ] = useState< Toast | null >( null );
	const [ submitting, setSubmitting ] = useState( false );
	const highlightedRef = useRef< Element | null >( null );

	const clearHighlight = useCallback( () => {
		if ( highlightedRef.current ) {
			highlightedRef.current.classList.remove( 'aai-highlight' );
			highlightedRef.current = null;
		}
	}, [] );

	const showToast = useCallback( ( message: string ) => {
		setToast( { message } );
	}, [] );

	// Hydrate pins from server on mount (open / in_progress / done for this URL).
	useEffect( () => {
		if ( ! config ) {
			return;
		}
		const url =
			config.restUrl +
			'?page_url=' +
			encodeURIComponent( config.pageUrl );
		fetch( url, {
			headers: { 'X-WP-Nonce': config.nonce },
			credentials: 'same-origin',
		} )
			.then( ( r ) => r.json() )
			.then( ( data ) => {
				const list = ( ( data?.annotations ??
					[] ) as Array< Record< string, unknown > > ).filter(
					( a ) => {
						const status = a.status as string | undefined;
						return (
							status !== 'verified' && status !== 'resolved'
						);
					}
				);
				setAnnotations(
					list.map( ( raw ) => {
						const id = String( raw.id ?? '' );
						return {
							clientId: id || generateClientId(),
							serverId: id || undefined,
							status:
								( raw.status as AnnotationStatus ) || 'open',
							note: String( raw.note ?? '' ),
							selector: String( raw.selector ?? '' ),
							element_tag: String( raw.element_tag ?? '' ),
							element_text: String( raw.element_text ?? '' ),
							isTextOnly: false, // recomputed when opening edit modal
							requested_text: raw.requested_text as
								| string
								| undefined,
							computed_styles:
								( raw.computed_styles as Record<
									string,
									string
								> ) ?? {},
							requested_changes:
								( raw.requested_changes as RequestedChanges ) ??
								{},
							page_url: String( raw.page_url ?? '' ),
							site_name: String( raw.site_name ?? '' ),
							viewport:
								( raw.viewport as {
									width: number;
									height: number;
								} ) ?? { width: 0, height: 0 },
							breakpoint:
								( raw.breakpoint as Breakpoint ) || 'all',
							resolution_note: raw.resolution_note as
								| string
								| undefined,
							changes: raw.changes as
								| AgentChange[]
								| undefined,
						};
					} )
				);
			} )
			.catch( () => {
				// Network/auth error — start with no pins.
			} );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	// Recompute pin positions whenever annotations change or the layout shifts.
	useEffect( () => {
		function update() {
			const positions: Record<
				string,
				{ left: number; top: number }
			> = {};
			annotations.forEach( ( a ) => {
				try {
					const el = document.querySelector( a.selector );
					if ( el ) {
						const rect = el.getBoundingClientRect();
						positions[ a.clientId ] = {
							left: window.scrollX + rect.left,
							top: window.scrollY + rect.top,
						};
					}
				} catch {
					// Invalid or stale selector — pin stays hidden.
				}
			} );
			setPinPositions( positions );
		}
		update();
		window.addEventListener( 'resize', update );
		return () => window.removeEventListener( 'resize', update );
	}, [ annotations ] );

	const adminBarShowing = config?.adminBarShowing ?? false;

	// Wire the WordPress admin bar item as the toolbar trigger (when visible).
	useEffect( () => {
		if ( ! adminBarShowing ) {
			return;
		}
		const link = document.querySelector< HTMLAnchorElement >(
			'#wp-admin-bar-annotate-ai a'
		);
		if ( ! link ) {
			return;
		}
		link.setAttribute(
			'aria-label',
			__( 'Annotate AI: toggle annotation mode', 'annotate-ai' )
		);
		const handler = ( e: MouseEvent ) => {
			e.preventDefault();
			setIsActive( ( v ) => ! v );
		};
		link.addEventListener( 'click', handler );
		return () => link.removeEventListener( 'click', handler );
	}, [ adminBarShowing ] );

	// Reflect annotation-mode state on the admin bar item.
	useEffect( () => {
		if ( ! adminBarShowing ) {
			return;
		}
		const item = document.getElementById( 'wp-admin-bar-annotate-ai' );
		const link = item?.querySelector( 'a' );
		if ( item ) {
			item.classList.toggle( 'is-active', isActive );
		}
		if ( link ) {
			link.setAttribute( 'aria-pressed', isActive ? 'true' : 'false' );
		}
	}, [ isActive, adminBarShowing ] );

	const modalOpen = addTarget !== null || editIndex !== null;

	useEffect( () => {
		if ( ! isActive || modalOpen ) {
			return;
		}

		function onMouseOver( e: MouseEvent ) {
			if ( isOurUI( e.target ) ) {
				return;
			}
			clearHighlight();
			const target = e.target as Element;
			target.classList.add( 'aai-highlight' );
			highlightedRef.current = target;
		}

		function onMouseOut( e: MouseEvent ) {
			if ( isOurUI( e.target ) ) {
				return;
			}
			clearHighlight();
		}

		function onClick( e: MouseEvent ) {
			if ( isOurUI( e.target ) ) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			clearHighlight();
			const target = e.target as HTMLElement;
			const rect = target.getBoundingClientRect();
			const text = getElementText( target );
			setAddTarget( {
				selector: getSelector( target ),
				tag: target.tagName.toLowerCase(),
				text,
				isTextOnly:
					target.children.length === 0 && text.length > 0,
				styles: getComputedStylesFor( target ),
				rect: {
					left: window.scrollX + rect.left,
					top: window.scrollY + rect.top,
				},
			} );
		}

		function onKey( e: KeyboardEvent ) {
			if ( e.key === 'Escape' ) {
				setIsActive( false );
			}
		}

		document.addEventListener( 'mouseover', onMouseOver, true );
		document.addEventListener( 'mouseout', onMouseOut, true );
		document.addEventListener( 'click', onClick, true );
		document.addEventListener( 'keydown', onKey );
		return () => {
			document.removeEventListener( 'mouseover', onMouseOver, true );
			document.removeEventListener( 'mouseout', onMouseOut, true );
			document.removeEventListener( 'click', onClick, true );
			document.removeEventListener( 'keydown', onKey );
			clearHighlight();
		};
	}, [ isActive, modalOpen, clearHighlight ] );

	const isFirstRender = useRef( true );
	useEffect( () => {
		if ( isFirstRender.current ) {
			isFirstRender.current = false;
			return;
		}
		showToast(
			isActive
				? __(
						'Annotation mode on — click any element (Esc to exit)',
						'annotate-ai'
				  )
				: __( 'Annotation mode off', 'annotate-ai' )
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ isActive ] );

	async function commitAddition( payload: {
		note: string;
		requestedText?: string;
		requestedChanges: RequestedChanges;
		breakpoint: Breakpoint;
	} ) {
		if ( ! addTarget || ! config ) {
			return;
		}
		const annotation: Annotation = {
			clientId: generateClientId(),
			status: 'open',
			note: payload.note,
			selector: addTarget.selector,
			element_tag: addTarget.tag,
			element_text: addTarget.text,
			isTextOnly: addTarget.isTextOnly,
			requested_text: payload.requestedText,
			computed_styles: addTarget.styles,
			requested_changes: payload.requestedChanges,
			page_url: config.pageUrl,
			site_name: config.siteName,
			viewport: { width: window.innerWidth, height: window.innerHeight },
			breakpoint: payload.breakpoint,
		};
		const next = [ ...annotations, annotation ];
		setAnnotations( next );
		setAddTarget( null );

		if ( ! willNotify ) {
			// "None" mode: persist immediately so the agent can pull whenever.
			try {
				const response = await fetch( config.restUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': config.nonce,
					},
					body: JSON.stringify( {
						note: annotation.note,
						selector: annotation.selector,
						element_tag: annotation.element_tag,
						element_text: annotation.element_text,
						requested_text: annotation.requested_text,
						computed_styles: annotation.computed_styles,
						requested_changes: annotation.requested_changes,
						page_url: annotation.page_url,
						site_name: annotation.site_name,
						viewport: annotation.viewport,
						breakpoint: annotation.breakpoint,
					} ),
				} );
				const result = ( await response.json() ) as {
					success?: boolean;
					annotation?: { id: string };
				};
				if ( ! result.success || ! result.annotation ) {
					throw new Error( 'Save failed' );
				}
				const serverId = result.annotation.id;
				setAnnotations( ( prev ) =>
					prev.map( ( a ) =>
						a.clientId === annotation.clientId
							? { ...a, serverId }
							: a
					)
				);
				showToast( __( 'Annotation saved', 'annotate-ai' ) );
			} catch ( err ) {
				// Roll back the pin and let the user retry.
				setAnnotations( ( prev ) =>
					prev.filter( ( a ) => a.clientId !== annotation.clientId )
				);
				showToast( __( 'Failed to save — try again', 'annotate-ai' ) );
			}
			return;
		}

		// Webhook/Telegram mode: keep batching locally; persist on Send.
		showToast(
			sprintf(
				/* translators: %d: number of pending annotations. */
				_n(
					'Annotation added (%d pending)',
					'Annotation added (%d pending)',
					next.length,
					'annotate-ai'
				),
				next.length
			)
		);
	}

	async function commitEdit( payload: {
		note: string;
		requestedText?: string;
		requestedChanges: RequestedChanges;
		breakpoint: Breakpoint;
	} ) {
		if ( editIndex === null || ! config ) {
			return;
		}
		const target = annotations[ editIndex ];
		setAnnotations( ( prev ) =>
			prev.map( ( a, i ) =>
				i === editIndex
					? {
							...a,
							note: payload.note,
							requested_text: payload.requestedText,
							requested_changes: payload.requestedChanges,
							breakpoint: payload.breakpoint,
					  }
					: a
			)
		);
		setEditIndex( null );

		if ( ! willNotify && target?.serverId ) {
			try {
				const response = await fetch(
					config.restUrl + '/' + target.serverId,
					{
						method: 'PATCH',
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Nonce': config.nonce,
						},
						body: JSON.stringify( {
							note: payload.note,
							requested_text: payload.requestedText,
							requested_changes: payload.requestedChanges,
							breakpoint: payload.breakpoint,
						} ),
					}
				);
				const result = ( await response.json() ) as { success?: boolean };
				if ( ! result.success ) {
					throw new Error( 'Update failed' );
				}
				showToast( __( 'Annotation updated', 'annotate-ai' ) );
			} catch ( err ) {
				showToast(
					__( 'Failed to update — try again', 'annotate-ai' )
				);
			}
			return;
		}

		showToast( __( 'Annotation updated', 'annotate-ai' ) );
	}

	async function setAnnotationStatus(
		index: number,
		nextStatus: AnnotationStatus,
		successToast: string,
		failureToast: string
	) {
		const target = annotations[ index ];
		if ( ! target?.serverId || ! config ) {
			return;
		}
		// Snapshot before the optimistic mutation so we can roll back if the
		// server rejects the change. Without this a failed PATCH would leave
		// the UI out of sync (e.g. a verified pin would have already disappeared).
		const previous = annotations;
		setReviewIndex( null );
		setAnnotations( ( prev ) => {
			if ( nextStatus === 'verified' ) {
				return prev.filter( ( _, i ) => i !== index );
			}
			return prev.map( ( a, i ) =>
				i === index ? { ...a, status: nextStatus } : a
			);
		} );
		try {
			const response = await fetch(
				config.restUrl + '/' + target.serverId,
				{
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': config.nonce,
					},
					body: JSON.stringify( { status: nextStatus } ),
				}
			);
			const result = ( await response.json() ) as { success?: boolean };
			if ( ! result.success ) {
				throw new Error( 'Status update failed' );
			}
			showToast( successToast );
		} catch ( err ) {
			setAnnotations( previous );
			showToast( failureToast );
		}
	}

	function verifyAnnotation( index: number ) {
		setAnnotationStatus(
			index,
			'verified',
			__( 'Marked as verified', 'annotate-ai' ),
			__( 'Failed to verify — try again', 'annotate-ai' )
		);
	}

	function reopenAnnotation( index: number ) {
		setAnnotationStatus(
			index,
			'open',
			__( 'Reopened for revision', 'annotate-ai' ),
			__( 'Failed to reopen — try again', 'annotate-ai' )
		);
	}

	const willNotify =
		( config?.notifyMethod ?? 'none' ) !== 'none';

	async function submitAll() {
		const pendingBatch = annotations.filter( ( a ) => ! a.serverId );
		if ( ! config || pendingBatch.length === 0 ) {
			return;
		}
		setSubmitting( true );
		try {
			const response = await fetch( config.restUrl + '/batch', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.nonce,
				},
				body: JSON.stringify( {
					annotations: pendingBatch.map( ( a ) => ( {
						note: a.note,
						selector: a.selector,
						element_tag: a.element_tag,
						element_text: a.element_text,
						requested_text: a.requested_text,
						computed_styles: a.computed_styles,
						requested_changes: a.requested_changes,
						page_url: a.page_url,
						site_name: a.site_name,
						viewport: a.viewport,
						breakpoint: a.breakpoint,
					} ) ),
				} ),
			} );
			const result = ( await response.json() ) as {
				success?: boolean;
				notified?: boolean;
				annotations?: Array< { id: string } >;
			};
			if ( ! result.success ) {
				throw new Error( 'Submit failed' );
			}
			const count = pendingBatch.length;
			// Mark the batched (no-serverId) annotations with the IDs the
			// server just assigned so the pins stay visible & editable.
			const newIds = ( result.annotations ?? [] ).map( ( a ) => a.id );
			let cursor = 0;
			setAnnotations( ( prev ) =>
				prev.map( ( a ) => {
					if ( a.serverId ) {
						return a;
					}
					const id = newIds[ cursor++ ];
					return id ? { ...a, serverId: id } : a;
				} )
			);
			showToast(
				result.notified
					? sprintf(
							/* translators: %d: number of annotations sent. */
							_n(
								'%d annotation sent to agent',
								'%d annotations sent to agent',
								count,
								'annotate-ai'
							),
							count
					  )
					: sprintf(
							/* translators: %d: number of annotations saved. */
							_n(
								'%d annotation saved',
								'%d annotations saved',
								count,
								'annotate-ai'
							),
							count
					  )
			);
			setIsActive( false );
		} catch ( err ) {
			showToast(
				willNotify
					? __( 'Failed to send — try again', 'annotate-ai' )
					: __( 'Failed to save — try again', 'annotate-ai' )
			);
		} finally {
			setSubmitting( false );
		}
	}

	if ( ! config ) {
		return null;
	}

	const editing = editIndex !== null ? annotations[ editIndex ] : null;
	const reviewing = reviewIndex !== null ? annotations[ reviewIndex ] : null;
	const pendingBatchCount = annotations.filter(
		( a ) => ! a.serverId
	).length;

	return (
		<>
			{ ! adminBarShowing && (
				<Button
					variant="primary"
					className="aai-floating-toggle"
					aria-label={ __(
						'Annotate AI: toggle annotation mode',
						'annotate-ai'
					) }
					aria-pressed={ isActive }
					onClick={ () => setIsActive( ( v ) => ! v ) }
				>
					{ __( 'Annotate', 'annotate-ai' ) }
				</Button>
			) }

			{ annotations.map( ( a, i ) => {
				const pos = pinPositions[ a.clientId ];
				if ( ! pos ) {
					return null;
				}
				const onPinClick = () => {
					if ( a.status === 'open' ) {
						// Server-hydrated pins don't carry isTextOnly; figure
						// it out from the current DOM so the modal can show
						// the text input when appropriate.
						let isTextOnly = a.isTextOnly;
						try {
							const el = document.querySelector( a.selector );
							if ( el ) {
								isTextOnly =
									el.children.length === 0 &&
									( el.textContent?.trim().length ?? 0 ) > 0;
							}
						} catch {
							// Selector invalid; leave as-is.
						}
						setAnnotations( ( prev ) =>
							prev.map( ( x, ii ) =>
								ii === i ? { ...x, isTextOnly } : x
							)
						);
						setEditIndex( i );
					} else if ( a.status === 'done' ) {
						setReviewIndex( i );
					}
					// in_progress: read-only, no action.
				};
				return (
					<Button
						key={ a.clientId }
						variant="primary"
						className="aai-pin"
						data-status={ a.status }
						aria-label={ sprintf(
							/* translators: %d: annotation number. */
							__( 'Annotation %d', 'annotate-ai' ),
							i + 1
						) }
						style={ { left: pos.left, top: pos.top } }
						onClick={ onPinClick }
						disabled={ a.status === 'in_progress' }
					>
						{ i + 1 }
					</Button>
				);
			} ) }

			{ willNotify && pendingBatchCount > 0 && (
				<Button
					variant="primary"
					className="aai-submit-all"
					disabled={ submitting }
					isBusy={ submitting }
					onClick={ submitAll }
				>
					{ submitting
						? __( 'Sending…', 'annotate-ai' )
						: sprintf(
								/* translators: %d: number of pending annotations. */
								_n(
									'Send %d annotation',
									'Send %d annotations',
									pendingBatchCount,
									'annotate-ai'
								),
								pendingBatchCount
						  ) }
				</Button>
			) }

			{ addTarget && (
				<AnnotationModal
					titleText={ __( 'Add Annotation', 'annotate-ai' ) }
					selector={ addTarget.selector }
					currentText={ addTarget.text }
					isTextOnly={ addTarget.isTextOnly }
					currentStyles={ addTarget.styles }
					presets={ config.presets }
					primaryLabel={ __( 'Add', 'annotate-ai' ) }
					onSubmit={ commitAddition }
					onClose={ () => setAddTarget( null ) }
				/>
			) }

			{ editing && (
				<AnnotationModal
					titleText={ sprintf(
						/* translators: %d: annotation number. */
						__( 'Annotation #%d', 'annotate-ai' ),
						( editIndex ?? 0 ) + 1
					) }
					selector={ editing.selector }
					currentText={ editing.element_text }
					isTextOnly={ editing.isTextOnly }
					currentStyles={ editing.computed_styles }
					presets={ config.presets }
					initialNote={ editing.note }
					initialRequestedText={ editing.requested_text }
					initialRequestedChanges={ editing.requested_changes }
					initialBreakpoint={ editing.breakpoint }
					primaryLabel={ __( 'Update', 'annotate-ai' ) }
					onSubmit={ commitEdit }
					onClose={ () => setEditIndex( null ) }
				/>
			) }

			{ reviewing && reviewIndex !== null && (
				<ReviewModal
					annotation={ reviewing }
					onVerify={ () => verifyAnnotation( reviewIndex ) }
					onReopen={ () => reopenAnnotation( reviewIndex ) }
					onClose={ () => setReviewIndex( null ) }
				/>
			) }

			{ toast && (
				<ToastView
					toast={ toast }
					onDismiss={ () => setToast( null ) }
				/>
			) }
		</>
	);
}
