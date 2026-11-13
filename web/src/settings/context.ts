// Entry point for opening the settings dialog from anywhere below the app root, e.g. the sidebar's model
// rows open it on 모델 연결: `useOpenSettings()('models')`.
import { createContext, useContext } from 'react';
import type { SettingsSection } from './model';

export type OpenSettings = (section?: SettingsSection) => void;
export const SettingsContext = createContext<OpenSettings>(() => {});
export const useOpenSettings = () => useContext(SettingsContext);
