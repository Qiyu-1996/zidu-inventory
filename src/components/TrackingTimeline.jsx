function formatUpdatedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function TrackingTimeline({ shipment, compact = false }) {
  if (!shipment) return null;
  const events = Array.isArray(shipment.trackingEvents) ? shipment.trackingEvents : [];
  const visibleEvents = compact ? events.slice(0, 3) : events;

  if (!shipment.trackingUpdatedAt && events.length === 0) {
    return <div className="text-xs text-gray-400">点击“更新物流”获取最新轨迹</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-green-800">{shipment.trackingState || '物流状态待更新'}</div>
          {shipment.trackingMessage && <div className="text-xs text-gray-600 mt-0.5">{shipment.trackingMessage}</div>}
        </div>
        {shipment.trackingUpdatedAt && <div className="text-xs text-gray-400 shrink-0">更新于 {formatUpdatedAt(shipment.trackingUpdatedAt)}</div>}
      </div>
      {visibleEvents.length > 0 && (
        <div className="border-l border-green-200 ml-1.5 space-y-3 py-1">
          {visibleEvents.map((event, index) => (
            <div key={`${event.time}-${index}`} className="relative pl-4">
              <span className={`absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full ${index === 0 ? 'bg-green-600' : 'bg-green-200'}`} />
              <div className="text-xs text-gray-700 leading-5">{event.context || '物流节点更新'}</div>
              <div className="text-xs text-gray-400">{event.time}{event.location ? ` · ${event.location}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
