/** Mac-like platforms use Cmd for shortcuts, everything else uses Ctrl. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Copy-as-image shortcut label (Mac shows symbols); the command menu and the export menu both show it. */
export const COPY_IMAGE_SHORTCUT = IS_MAC ? '⇧⌥C' : 'Shift+Alt+C';
/** Where the top bar shows the export menu (Tailwind `md`). Below this width the menu is hidden. */
export const EXPORT_MENU_QUERY = '(min-width: 768px)';
