import Script from "next/script";

const importMap = JSON.stringify(
  {
    imports: {
      three: "/three/build/three.webgpu.js",
      "three/webgpu": "/three/build/three.webgpu.js",
      "three/tsl": "/three/build/three.tsl.js",
      "three/addons/": "/three/jsm/",
    },
  },
  null,
  2,
);

export default function Home() {
  return (
    <>
      <Script
        id="cloud-importmap"
        type="importmap"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: importMap }}
      />
      <Script
        id="cloud-module"
        type="module"
        strategy="afterInteractive"
        src="/three/cloud.js"
      />
      <div id="info" className="cloud-info">
        <a
          href="https://threejs.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="logo-link"
        />

        <div className="title-wrapper">
          <a
            href="https://threejs.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            UI Context
          </a>
          <span>context layer for AI agents</span>
        </div>

        <small>coming soon</small>
      </div>
    </>
  );
}
