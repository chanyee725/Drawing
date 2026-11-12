// Loads the vendored diagrams.net viewer (web/static/vendor/drawio, Apache-2.0) once.
// Every path the viewer could fetch lazily points at this server, never a CDN.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Drawio = {
  Graph: any;
  mxCodec: any;
  mxUtils: any;
  mxEvent: any;
};

const BASE = `${import.meta.env.BASE_URL}vendor/drawio`;
let loading: Promise<Drawio> | null = null;

export function loadDrawio(): Promise<Drawio> {
  if (loading) return loading;
  loading = new Promise<Drawio>((resolve, reject) => {
    const w = window as any;
    w.STYLE_PATH = `${BASE}/styles`;
    w.SHAPES_PATH = `${BASE}/shapes`;
    w.STENCIL_PATH = `${BASE}/stencils`;
    w.GRAPH_IMAGE_PATH = `${BASE}/img`;
    w.IMAGE_PATH = `${BASE}/images`;
    w.RESOURCES_PATH = `${BASE}/resources`;
    w.PROXY_URL = '';
    w.mxLoadResources = false;
    w.mxLoadStylesheets = false;
    const s = document.createElement('script');
    s.src = `${BASE}/viewer-static.min.js`;
    s.async = true;
    s.onload = () => {
      // Web fonts named in a diagram would be fetched from Google Fonts; stay offline.
      if (typeof w.Graph?.addFont === 'function') w.Graph.addFont = () => null;
      resolve({ Graph: w.Graph, mxCodec: w.mxCodec, mxUtils: w.mxUtils, mxEvent: w.mxEvent });
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('viewer script failed to load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
