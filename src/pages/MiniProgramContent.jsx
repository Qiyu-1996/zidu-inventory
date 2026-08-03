import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Image as ImageIcon, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { Card } from '../components/ui';
import * as api from '../lib/api';

let localBannerId = 0;

function publicPreviewUrl(value) {
  const url = String(value || '').trim();
  const match = url.match(/^cloud:\/\/[^.]+\.([^/]+)\/(.+)$/);
  return match ? `https://${match[1]}.tcb.qcloud.la/${match[2]}` : url;
}

function normalizeBanner(item) {
  return {
    localKey: item.id == null ? `new-${++localBannerId}` : `banner-${item.id}`,
    id: item.id ?? null,
    key: item.key || '',
    title: item.title || '',
    subtitle: item.subtitle || '',
    imageUrl: item.imageUrl || '',
    targetPath: item.targetPath || '',
    sortOrder: Number(item.sortOrder || 0),
    active: Boolean(item.active)
  };
}

function emptyBanner(sortOrder) {
  return normalizeBanner({
    title: '', subtitle: '', imageUrl: '', targetPath: '', sortOrder, active: false
  });
}

function BannerPreview({ banner }) {
  const image = publicPreviewUrl(banner.imageUrl);
  return <div className="relative h-72 rounded-xl overflow-hidden bg-[#F1ECFA] border">
    {image
      ? <img src={image} alt={banner.title || '首页轮播预览'} className="absolute inset-0 w-full h-full object-cover" />
      : <div className="absolute inset-0 flex flex-col items-center justify-center text-purple-300"><ImageIcon size={30} /><span className="text-xs mt-2">上传首页 KV</span></div>}
    {!!(banner.title || banner.subtitle) && <div className="absolute inset-x-0 bottom-0 px-5 pb-7 pt-16 text-white" style={{ background: 'linear-gradient(180deg, transparent, rgba(45,31,58,.55))' }}>
      {!!banner.title && <div className="text-xl font-semibold tracking-wide">{banner.title}</div>}
      {!!banner.subtitle && <div className="text-sm mt-1 opacity-90">{banner.subtitle}</div>}
    </div>}
    <div className={`absolute top-3 right-3 px-2 py-1 rounded-full text-[11px] ${banner.active ? 'bg-purple-600 text-white' : 'bg-white/90 text-gray-500'}`}>{banner.active ? '轮播中' : '未启用'}</div>
  </div>;
}

export default function MiniProgramContent() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [uploadingKey, setUploadingKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await api.fetchMiniProgramContentAdmin();
      setBanners((next.banners || []).map(normalizeBanner));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeCount = useMemo(() => banners.filter(item => item.active).length, [banners]);
  const patchBanner = (localKey, patch) => setBanners(current => current.map(item => item.localKey === localKey ? { ...item, ...patch } : item));

  const addBanner = () => {
    const maxSort = banners.reduce((max, item) => Math.max(max, Number(item.sortOrder || 0)), 0);
    setBanners(current => [...current, emptyBanner(maxSort + 10)]);
  };

  const upload = async (banner, file) => {
    if (!file || uploadingKey) return;
    setUploadingKey(banner.localKey);
    setError('');
    try {
      const url = await api.uploadMiniProgramContentImage(file, 'home-banners');
      patchBanner(banner.localKey, { imageUrl: url });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploadingKey('');
    }
  };

  const save = async banner => {
    if (savingKey) return;
    setSavingKey(banner.localKey);
    setError('');
    try {
      await api.saveMiniProgramHomeBanner(banner.id, {
        title: banner.title,
        subtitle: banner.subtitle,
        imageUrl: String(banner.imageUrl || '').trim(),
        targetPath: String(banner.targetPath || '').trim(),
        sortOrder: Number(banner.sortOrder || 0),
        active: banner.active
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey('');
    }
  };

  const remove = async banner => {
    if (savingKey) return;
    if (banner.id == null) {
      setBanners(current => current.filter(item => item.localKey !== banner.localKey));
      return;
    }
    if (!window.confirm('确定删除这张首页轮播图吗？删除后无法从后台恢复。')) return;
    setSavingKey(banner.localKey);
    setError('');
    try {
      await api.deleteMiniProgramHomeBanner(banner.id);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey('');
    }
  };

  return <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <Card className="p-4"><div className="text-xs text-gray-500">轮播图总数</div><div className="text-2xl font-semibold mt-1">{banners.length}</div></Card>
      <Card className="p-4"><div className="text-xs text-gray-500">当前启用</div><div className="text-2xl font-semibold mt-1 text-purple-700">{activeCount}</div></Card>
      <Card className="p-4 col-span-2 lg:col-span-1"><div className="text-xs text-gray-500">发布方式</div><div className="text-base font-semibold mt-2">下次进入小程序生效</div></Card>
    </div>

    <Card className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-gray-800">首页轮播图</div>
          <div className="text-sm text-gray-500 mt-1">上传整屏 KV，设置显示顺序、标题和点击后的页面；最多同时启用 8 张。</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-gray-600 disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />刷新</button>
          <button onClick={addBanner} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm"><Plus size={14} />新增轮播</button>
        </div>
      </div>
    </Card>

    {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}

    <div className="space-y-4">
      {banners.map((banner, index) => <Card key={banner.localKey} className={`p-5 ${banner.active ? 'ring-1 ring-purple-200' : ''}`}>
        <div className="grid lg:grid-cols-[230px_minmax(0,1fr)] gap-5">
          <BannerPreview banner={banner} />
          <div className="space-y-4 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold text-gray-800">第 {index + 1} 张</div><div className="text-[11px] text-gray-400 mt-1 font-mono">{banner.key || '保存后生成内容编号'}</div></div>
              <button type="button" onClick={() => patchBanner(banner.localKey, { active: !banner.active })} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${banner.active ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-500'}`}>{banner.active ? <Eye size={14} /> : <EyeOff size={14} />}{banner.active ? '已启用' : '未启用'}</button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs text-gray-500">中文标题<input value={banner.title} maxLength={80} onChange={event => patchBanner(banner.localKey, { title: event.target.value })} placeholder="文字已在图片内可留空" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
              <label className="text-xs text-gray-500">副标题<input value={banner.subtitle} maxLength={120} onChange={event => patchBanner(banner.localKey, { subtitle: event.target.value })} placeholder="例如 Natural Wellness；可留空" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
              <label className="text-xs text-gray-500">显示顺序<input type="number" min="-10000" max="10000" step="1" value={banner.sortOrder} onChange={event => patchBanner(banner.localKey, { sortOrder: event.target.value })} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
              <label className="text-xs text-gray-500">点击跳转<input value={banner.targetPath} maxLength={500} onChange={event => patchBanner(banner.localKey, { targetPath: event.target.value })} placeholder="如 /pages/shop/index；不跳转则留空" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-800" /></label>
            </div>

            <label className="block text-xs text-gray-500">图片地址<input value={banner.imageUrl} onChange={event => patchBanner(banner.localKey, { imageUrl: event.target.value })} placeholder="上传后自动填写，也可粘贴 https:// 或 cloud:// 地址" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700" /></label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${uploadingKey ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                <Upload size={14} />{uploadingKey === banner.localKey ? '上传中' : '上传替换图片'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={Boolean(uploadingKey)} className="hidden" onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) upload(banner, file);
                }} />
              </label>
              <div className="flex gap-2">
                <button onClick={() => remove(banner)} disabled={savingKey === banner.localKey} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><Trash2 size={14} />删除</button>
                <button onClick={() => save(banner)} disabled={Boolean(savingKey)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-40"><Save size={14} />{savingKey === banner.localKey ? '保存中' : '保存并发布'}</button>
              </div>
            </div>
          </div>
        </div>
      </Card>)}
    </div>

    {!loading && !banners.length && <Card className="p-12 text-center text-sm text-gray-400">还没有首页轮播图，新增并启用后才会替换小程序内置 KV。</Card>}
  </div>;
}
