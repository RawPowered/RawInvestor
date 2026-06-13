import './developerModeToggleDemo.css';

export function DeveloperModeToggleDemo({
  active = false,
  animate = true,
}: {
  active?: boolean;
  animate?: boolean;
}) {
  const loopClass = animate && active ? 'pcgr-animate-loop' : '';
  const onClass = animate && active ? '' : active ? 'pcgr-toggle-on' : '';

  return (
    <div className="pcgr-ext-demo" role="img" aria-label="Illustration: turn on Developer mode in browser extensions">
      <div className="pcgr-ext-demo-frame">
        <div className="pcgr-ext-demo-topbar">
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#94a3b8',
              display: 'inline-block',
            }}
          />
          Extensions
        </div>
        <div className="pcgr-ext-demo-body">
          <div className="pcgr-ext-demo-sidebar">
            <div className="pcgr-ext-demo-dev-row">
              <span className={`pcgr-ext-demo-dev-label ${active ? 'pcgr-pulse-once' : ''}`}>
                Developer mode
              </span>
              <div
                className={`pcgr-ext-demo-toggle ${loopClass} ${onClass}`.trim()}
                aria-hidden
              >
                <span className="pcgr-ext-demo-knob" />
              </div>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--pcgr-demo-muted)' }}>My extensions</p>
          </div>
          <div className="pcgr-ext-demo-main">Extension cards appear here after Developer mode is on.</div>
        </div>
      </div>
      {active ? (
        <p className="text-[10px] text-emerald-300/90 mt-2 text-center font-medium">
          Turn the switch <strong className="text-emerald-200">ON</strong> (left sidebar on Edge, or top-right on Chrome).
        </p>
      ) : null}
    </div>
  );
}
