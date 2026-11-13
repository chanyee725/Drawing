/**
 * The app's keyboard focus ring (design doc 5 §3.3): a 2px --ring outline with a 1px offset. Added after a ui/*
 * component's own classes, it also switches off shadcn's 3px translucent ring (tailwind-merge keeps the last one).
 */
export const FOCUS_RING = 'focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-ring';
