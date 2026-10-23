import { createContext, useContext } from 'react';

/** True while the opening splash cover is visible; loaders stay hidden beneath it. */
export const SplashActiveContext = createContext(false);
export const useSplashActive = () => useContext(SplashActiveContext);
