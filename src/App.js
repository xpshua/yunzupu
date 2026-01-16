import React, { useState, useEffect, useRef, useMemo } from 'react';

const injectStyles = () => {
  if (!document.getElementById('tailwind-cdn')) {
    const script = document.createElement('script');
    script.id = 'tailwind-cdn';
    script.src = 'https://cdn.tailwindcss.com';
    document.head.appendChild(script);
  }
  const styles = `
    body { margin: 0; background-color: #F8FAFC; overflow: hidden; touch-action: none; font-family: system-ui, -apple-system, sans-serif; }
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 10px; }
    .glass-nav { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
    canvas { background-image: radial-gradient(#E2E8F0 1.2px, transparent 1.2px); background-size: 35px 35px; }
    .modal-up { animation: modalUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes modalUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .active-node { transition: all 0.3s ease; }
  `;
  if (!document.getElementById('custom-styles')) {
    const style = document.createElement('style');
    style.id = 'custom-styles';
    style.innerHTML = styles;
    document.head.appendChild(style);
  }
};

// 从环境变量获取Supabase配置
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// 检查环境变量
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('缺少Supabase环境变量配置 - 请在部署时设置');
}

// 检查URL格式是否正确
if (SUPABASE_URL && !SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.startsWith('http://')) {
  console.error('Supabase URL 必须以 https:// 开头');
}

// 初始化Supabase客户端
let supabaseClient = null;

const APP_DATA_ID = 'genealogy-stable-v2'; 

const toChineseGen = (n) => {
  const map = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return n <= 12 ? `第 ${map[n]} 代` : `第 ${n} 代`;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [myId, setMyId] = useState(localStorage.getItem(`my_id_${APP_DATA_ID}`) || null);
  const [view, setView] = useState('tree'); 
  const [searchQuery, setSearchQuery] = useState('');
  
  const [transform, setTransform] = useState({ x: window.innerWidth / 2 - 90, y: 150, scale: 0.7 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [moveCount, setMoveCount] = useState(0); 
  const [initialDist, setInitialDist] = useState(null); 
  const [modalType, setModalType] = useState(null); 
  const [form, setForm] = useState({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);

  useEffect(() => {
    injectStyles();
  }, []);

  // 初始化Supabase
  useEffect(() => {
    // 检查环境变量是否设置
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError('缺少Supabase环境变量配置。请确保设置了 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY');
      setLoading(false);
      return;
    }

    // 检查URL格式
    if (!SUPABASE_URL.startsWith('https://')) {
      setError('Supabase URL 必须以 https:// 开头');
      setLoading(false);
      return;
    }

    // 导入Supabase客户端
    import('@supabase/supabase-js').then(({ createClient }) => {
      try {
        // 创建Supabase客户端实例
        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        // 设置全局supabaseClient
        supabaseClient = supabase;
        
        // 获取初始数据
        const fetchInitialData = async () => {
          try {
            // 获取成员数据
            let { data: membersData, error: membersError } = await supabase
              .from('members')
              .select('*')
              .eq('app_id', APP_DATA_ID);
            
            if (membersError) {
              console.error('获取成员数据失败:', membersError);
              setError(`获取成员数据失败: ${membersError.message}`);
              return;
            }
            setMembers(membersData || []);
            
            // 获取事件数据并按时间倒序排序
            let { data: eventsData, error: eventsError } = await supabase
              .from('events')
              .select('*')
              .eq('app_id', APP_DATA_ID)
              .order('date', { ascending: false });
            
            if (eventsError) {
              console.error('获取事件数据失败:', eventsError);
              setError(`获取事件数据失败: ${eventsError.message}`);
              return;
            }
            setEvents(eventsData || []);
          } catch (error) {
            console.error('获取初始数据失败:', error);
            setError(`获取初始数据失败: ${error.message}`);
          } finally {
            setLoading(false);
          }
        };

        fetchInitialData();

        // 监听成员数据变化
        const membersChannel = supabase
          .channel('members-changes')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'members',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              setMembers(prev => [...prev, payload.new]);
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'members',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              setMembers(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'members',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              setMembers(prev => prev.filter(m => m.id !== payload.old.id));
            }
          )
          .subscribe();

        // 监听事件数据变化
        const eventsChannel = supabase
          .channel('events-changes')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'events',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              // 插入新事件并保持倒序排序
              setEvents(prev => [payload.new, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'events',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              setEvents(prev => prev.map(e => e.id === payload.new.id ? payload.new : e));
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'events',
              filter: `app_id=eq.${APP_DATA_ID}`
            },
            (payload) => {
              setEvents(prev => prev.filter(e => e.id !== payload.old.id));
            }
          )
          .subscribe();

        // 清理函数
        return () => {
          if (membersChannel) {
            supabase.removeChannel(membersChannel);
          }
          if (eventsChannel) {
            supabase.removeChannel(eventsChannel);
          }
        };
      } catch (err) {
        console.error('初始化Supabase客户端失败:', err);
        setError(`初始化Supabase客户端失败: ${err.message}`);
        setLoading(false);
      }
    }).catch(err => {
      console.error('导入Supabase客户端失败:', err);
      setError(`导入Supabase客户端失败: ${err.message}`);
      setLoading(false);
    });
  }, []);

  const processedNodes = useMemo(() => {
    if (members.length === 0) return {};
    const nodes = {};
    const gens = {};
    members.forEach(m => {
      const g = m.generation || 1;
      if (!gens[g]) gens[g] = [];
      gens[g].push(m);
    });

    const CARD_W = 180, GEN_H = 260, GAP_X = 60;

    Object.keys(gens).sort((a,b)=>parseInt(a)-parseInt(b)).forEach(g => {
      const genNum = parseInt(g);
      const currentGen = gens[genNum];
      currentGen.sort((a, b) => (nodes[a.fatherId]?.x || 0) - (nodes[b.fatherId]?.x || 0));

      const mainOnes = currentGen.filter(m => !m.isSpouseOf);
      const spouses = currentGen.filter(m => m.isSpouseOf);
      
      let totalW = mainOnes.reduce((acc, m) => {
        const hasS = spouses.some(s => s.isSpouseOf === m.id);
        return acc + (hasS ? CARD_W * 2 + 15 : CARD_W);
      }, 0) + (mainOnes.length - 1) * GAP_X;

      let startX = -totalW / 2;
      mainOnes.forEach(m => {
        nodes[m.id] = { ...m, x: startX, y: (genNum - 1) * GEN_H };
        const sp = spouses.find(s => s.isSpouseOf === m.id);
        if (sp) {
          nodes[sp.id] = { ...sp, x: startX + CARD_W + 15, y: (genNum - 1) * GEN_H };
          startX += (CARD_W * 2 + 15 + GAP_X);
        } else {
          startX += (CARD_W + GAP_X);
        }
      });
    });
    return nodes;
  }, [members]);

  const getAppellation = (tid) => {
    if (!myId || !processedNodes[myId] || !processedNodes[tid]) return null;
    const me = processedNodes[myId], t = processedNodes[tid];
    const diff = t.generation - me.generation;
    const isF = t.gender === '女';

    if (myId === tid) return "本人";
    if (t.isSpouseOf === myId) return isF ? "妻子" : "丈夫";
    if (me.isSpouseOf === tid) return isF ? "妻子" : "丈夫";

    if (diff === 1) {
      if (t.fatherId === me.id || (me.isSpouseOf && t.fatherId === me.isSpouseOf)) return isF ? "女儿" : "儿子";
      if (t.isSpouseOf) {
        const spouseNode = processedNodes[t.isSpouseOf];
        if (spouseNode && (spouseNode.fatherId === me.id || (me.isSpouseOf && spouseNode.fatherId === me.isSpouseOf))) return isF ? "儿媳" : "女婿";
      }
      return isF ? "侄女/外甥女" : "侄子/外甥";
    }

    if (diff === 0) {
      if (t.fatherId === me.fatherId && t.fatherId) return isF ? "姐妹" : "兄弟";
      const meF = processedNodes[me.fatherId], tF = processedNodes[t.fatherId];
      if (meF && tF && meF.fatherId === tF.fatherId) return isF ? "堂姐妹" : "堂兄弟";
      return "同辈";
    }

    if (diff === -1) {
      if (t.id === me.fatherId || t.isSpouseOf === me.fatherId) return isF ? "母亲" : "父亲";
      const meF = processedNodes[me.fatherId];
      if (meF && t.fatherId === meF.fatherId) return isF ? "姑姑" : (t.x < meF.x ? "伯父" : "叔父");
      return "长辈";
    }

    if (diff === -2) return isF ? "奶奶/外婆" : "爷爷/外公";
    if (diff === 2) return isF ? "孙女/外孙女" : "孙子/外孙";

    return toChineseGen(t.generation);
  };

  const locateMember = (id) => {
    const n = processedNodes[id];
    if (!n) return;
    setTransform({ x: (window.innerWidth/2) - (n.x + 90) * 0.8, y: (window.innerHeight/2) - (n.y + 50) * 0.8, scale: 0.8 });
    setSelectedId(id); setModalType(null);
  };

  // 以指针为中心缩放的高级算法
  const handleZoom = (e, delta) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const mouseY = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(transform.scale * zoomFactor, 0.15), 3);
    
    setTransform(prev => ({
      x: mouseX - (mouseX - prev.x) * (newScale / prev.scale),
      y: mouseY - (mouseY - prev.y) * (newScale / prev.scale),
      scale: newScale
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view !== 'tree') return;
    const ctx = canvas.getContext('2d');
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
      ctx.scale(dpr, dpr); ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      
      ctx.save(); 
      ctx.translate(transform.x, transform.y); 
      ctx.scale(transform.scale, transform.scale);
      
      // 绘制连线
      members.forEach(m => {
        const n = processedNodes[m.id]; if (!n) return;
        if (m.fatherId && processedNodes[m.fatherId]) {
          const f = processedNodes[m.fatherId];
          ctx.beginPath(); ctx.moveTo(f.x + 90, f.y + 100);
          ctx.bezierCurveTo(f.x + 90, f.y + 180, n.x + 90, n.y - 60, n.x + 90, n.y);
          ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.stroke();
        }
        if (m.isSpouseOf && processedNodes[m.isSpouseOf]) {
          const p = processedNodes[m.isSpouseOf];
          ctx.beginPath(); ctx.setLineDash([5, 5]); ctx.moveTo(p.x + 180, p.y + 50); ctx.lineTo(n.x, n.y + 50);
          ctx.strokeStyle = '#F43F5E'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
      });

      // 绘制成员卡片
      members.forEach(m => {
        const n = processedNodes[m.id]; if (!n) return;
        const isS = selectedId === m.id;
        const isMe = myId === m.id;
        
        // 阴影与光效提升
        ctx.save();
        if (isS) {
          ctx.shadowColor = 'rgba(79, 70, 229, 0.3)';
          ctx.shadowBlur = 30;
          ctx.shadowOffsetY = 15;
        } else {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.04)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 4;
        }

        ctx.fillStyle = isS ? (m.gender === '女' ? '#F43F5E' : '#4F46E5') : '#FFFFFF';
        if (isMe && !isS) ctx.fillStyle = '#FFFBEB'; 
        ctx.beginPath(); ctx.roundRect(n.x, n.y, 180, 100, 20); ctx.fill();
        ctx.restore();
        
        ctx.strokeStyle = isMe ? '#F59E0B' : (isS ? 'transparent' : (m.gender === '女' ? '#FFE4E6' : '#EEF2FF'));
        ctx.lineWidth = isMe ? 3 : 2; ctx.stroke();
        
        const appel = getAppellation(m.id) || toChineseGen(m.generation);
        ctx.fillStyle = isS ? '#FFFFFF' : (m.gender === '女' ? '#F43F5E' : '#4F46E5');
        ctx.beginPath(); ctx.roundRect(n.x + 30, n.y - 14, 120, 26, 13); ctx.fill();
        ctx.fillStyle = isS ? (m.gender === '女' ? '#F43F5E' : '#4F46E5') : '#FFFFFF';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(appel, n.x + 90, n.y + 4);

        ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(m.avatar || (m.gender === '女' ? '👩' : '👨'), n.x + 45, n.y + 65);

        ctx.fillStyle = isS ? '#FFFFFF' : '#1E293B'; ctx.textAlign = 'left';
        ctx.font = 'bold 18px sans-serif'; ctx.fillText(m.name, n.x + 85, n.y + 52);
        ctx.fillStyle = isS ? 'rgba(255,255,255,0.8)' : '#94A3B8';
        ctx.font = '11px sans-serif'; ctx.fillText(m.birth || '生日未登记', n.x + 85, n.y + 74);
      });
      ctx.restore();
    };
    render();
  }, [members, processedNodes, transform, selectedId, view, myId]);

  const handleEnd = (x, y) => {
    setIsDragging(false); if (modalType) return; 
    if (moveCount < 6) { 
      const rect = canvasRef.current.getBoundingClientRect();
      const wx = (x - rect.left - transform.x) / transform.scale;
      const wy = (y - rect.top - transform.y) / transform.scale;
      const hit = Object.values(processedNodes).find(m => wx > m.x && wx < m.x + 180 && wy > m.y && wy < m.y + 100);
      setSelectedId(hit?.id || null);
    }
  };

  const handleAction = async () => {
    // 检查Supabase配置
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError('缺少Supabase环境变量配置。请确保设置了 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY');
      return;
    }

    if (!supabaseClient) {
      setError('Supabase客户端未初始化，请刷新页面重试');
      return;
    }

    try {
      if (modalType === 'add_root') {
        const newId = `member-${Date.now()}`;
        const newMember = { 
          id: newId, 
          name: form.name, 
          gender: form.gender, 
          birth: form.birth, 
          avatar: form.avatar, 
          generation: 1,
          app_id: APP_DATA_ID
        };
        const { error } = await supabaseClient.from('members').insert([newMember]);
        if (error) {
          console.error('添加根成员失败:', error);
          setError(`添加根成员失败: ${error.message}`);
          return;
        }
      } else if (modalType === 'add_child') {
        const newId = `member-${Date.now()}`;
        const newMember = { 
          id: newId, 
          name: form.name, 
          gender: form.gender, 
          birth: form.birth, 
          avatar: form.avatar, 
          generation: processedNodes[selectedId].generation + 1, 
          father_id: selectedId,
          app_id: APP_DATA_ID
        };
        const { error } = await supabaseClient.from('members').insert([newMember]);
        if (error) {
          console.error('添加子成员失败:', error);
          setError(`添加子成员失败: ${error.message}`);
          return;
        }
      } else if (modalType === 'add_spouse') {
        const newId = `member-${Date.now()}`;
        const newMember = { 
          id: newId, 
          name: form.name, 
          gender: form.gender, 
          birth: form.birth, 
          avatar: form.avatar, 
          generation: processedNodes[selectedId].generation, 
          is_spouse_of: selectedId,
          app_id: APP_DATA_ID
        };
        const { error } = await supabaseClient.from('members').insert([newMember]);
        if (error) {
          console.error('添加配偶失败:', error);
          setError(`添加配偶失败: ${error.message}`);
          return;
        }
      } else if (modalType === 'edit') {
        const { error } = await supabaseClient
          .from('members')
          .update({
            name: form.name,
            gender: form.gender,
            birth: form.birth,
            avatar: form.avatar
          })
          .eq('id', selectedId);
        if (error) {
          console.error('更新成员失败:', error);
          setError(`更新成员失败: ${error.message}`);
          return;
        }
      } else if (modalType === 'add_event') {
        const newId = `event-${Date.now()}`;
        const newEvent = { 
          id: newId, 
          title: form.name, 
          date: form.date, 
          content: form.content,
          app_id: APP_DATA_ID
        };
        const { error } = await supabaseClient.from('events').insert([newEvent]);
        if (error) {
          console.error('添加事件失败:', error);
          setError(`添加事件失败: ${error.message}`);
          return;
        }
      }
      setModalType(null); 
      setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
      setError(null); // 清除错误信息
    } catch (err) {
      console.error('操作失败:', err);
      setError(`操作失败: ${err.message}`);
    }
  };

  const exportCanvas = () => {
    const link = document.createElement('a');
    link.download = 'family-tree.png';
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  if (loading && !error) return <div className="fixed inset-0 flex flex-col items-center justify-center bg-white"><div className="animate-spin w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full mb-4"></div><p className="text-slate-400 font-bold">同步宗族数据...</p></div>;

  return (
    <div className="fixed inset-0 bg-slate-50 flex flex-col overflow-hidden">
      {/* 错误提示 */}
      {error && (
        <div className="fixed top-20 left-4 right-4 z-[150] bg-red-100 border border-red-300 text-red-700 p-4 rounded-xl shadow-lg">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-bold text-sm">错误信息</h3>
              <p className="text-xs mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div className="mt-3 text-xs text-red-600">
            <p>常见解决方案：</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>检查环境变量是否正确设置</li>
              <li>确保Supabase项目URL和密钥无误</li>
              <li>检查Supabase数据库表是否存在</li>
              <li>确保网络连接正常</li>
            </ul>
          </div>
        </div>
      )}

      {/* 顶部导航 */}
      <header className="fixed top-4 left-4 right-4 h-16 z-[100] flex justify-between items-center px-5 glass-nav rounded-2xl shadow-xl border border-white/50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-100">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-black text-slate-800">云端族谱</h1>
            <p className="text-[10px] text-slate-400 font-bold">实时同步 · {members.length} 人</p>
          </div>
        </div>
        <nav className="flex bg-slate-200/50 p-1 rounded-xl">
          <button onClick={() => setView('tree')} className={`px-5 py-1.5 rounded-lg text-xs font-black transition-all ${view === 'tree' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>脉络图</button>
          <button onClick={() => setView('events')} className={`px-5 py-1.5 rounded-lg text-xs font-black transition-all ${view === 'events' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>大事记</button>
        </nav>
        <div className="flex gap-2">
           <button onClick={() => setModalType('search')} className="p-2.5 bg-white rounded-xl text-slate-400 border border-slate-100 shadow-sm hover:bg-slate-50">
             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <circle cx="11" cy="11" r="8"></circle>
               <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
             </svg>
           </button>
           <button onClick={() => isAdmin ? setIsAdmin(false) : setModalType('pwd')} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${isAdmin ? 'bg-rose-500 text-white' : 'bg-white border text-slate-600 hover:border-indigo-200'}`}>{isAdmin ? '退出' : '管理'}</button>
        </div>
      </header>

      <main className="flex-1 relative">
        {members.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-10">
            <div className="w-24 h-24 bg-indigo-50 text-indigo-600 rounded-[32px] flex items-center justify-center mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">族谱开篇</h2>
            <p className="text-slate-400 mb-8 max-w-xs">当前为空，请管理员验证后添加第一位祖先。</p>
            {isAdmin && <button onClick={() => setModalType('add_root')} className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl">创建始祖</button>}
          </div>
        ) : (
          view === 'tree' ? (
            <canvas ref={canvasRef} 
              onMouseDown={e => { setIsDragging(true); setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y }); setMoveCount(0); }}
              onMouseMove={e => isDragging && (setMoveCount(c => c+1), setTransform(t => ({...t, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y})))}
              onMouseUp={e => handleEnd(e.clientX, e.clientY)}
              onTouchStart={e => {
                if (e.touches.length === 2) setInitialDist(Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY));
                else { setIsDragging(true); setDragStart({ x: e.touches[0].clientX - transform.x, y: e.touches[0].clientY - transform.y }); setMoveCount(0); }
              }}
              onTouchMove={e => {
                if (e.touches.length === 2 && initialDist) {
                  const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                  const scaleFactor = dist / initialDist;
                  handleZoom({ clientX: (e.touches[0].clientX + e.touches[1].clientX)/2, clientY: (e.touches[0].clientY + e.touches[1].clientY)/2 }, scaleFactor > 1 ? 1 : -1);
                  setInitialDist(dist);
                } else if (isDragging) { setMoveCount(c => c+1); setTransform(p => ({ ...p, x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y })); }
              }}
              onTouchEnd={e => handleEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY)}
              onWheel={e => handleZoom(e, e.deltaY < 0 ? 1 : -1)}
              className="w-full h-full cursor-grab active:cursor-grabbing transition-opacity duration-500"
            />
          ) : (
            <div className="h-full pt-28 overflow-y-auto p-6 max-w-2xl mx-auto pb-24 custom-scrollbar">
               <div className="flex justify-between items-end mb-10">
                  <h1 className="text-3xl font-black text-slate-900">家族春秋</h1>
                  {isAdmin && <button onClick={() => setModalType('add_event')} className="bg-indigo-600 text-white p-3 rounded-2xl shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>}
               </div>
               <div className="space-y-8 border-l-4 border-slate-100 ml-4 pl-8">
                  {events.map(ev => (
                    <div key={ev.id} className="bg-white p-6 rounded-[24px] shadow-sm border border-slate-100 relative group transition-all hover:shadow-xl">
                      <div className="absolute -left-[44px] top-6 w-5 h-5 rounded-full bg-white border-4 border-indigo-600 z-10"></div>
                      <div className="text-indigo-600 font-black text-xs mb-2">{ev.date}</div>
                      <h3 className="text-lg font-black text-slate-800 mb-1">{ev.title}</h3>
                      <p className="text-slate-500 text-sm leading-relaxed">{ev.content}</p>
                      {isAdmin && <button onClick={async () => {
                        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
                          setError('缺少Supabase环境变量配置');
                          return;
                        }
                        
                        if (!supabaseClient) {
                          setError('Supabase客户端未初始化');
                          return;
                        }
                        
                        try {
                          const { error } = await supabaseClient.from('events').delete().eq('id', ev.id);
                          if (error) {
                            console.error('删除事件失败:', error);
                            setError(`删除事件失败: ${error.message}`);
                          }
                        } catch (err) {
                          console.error('删除事件失败:', err);
                          setError(`删除事件失败: ${err.message}`);
                        }
                      }} className="absolute top-4 right-4 text-slate-200 hover:text-rose-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>}
                    </div>
                  ))}
               </div>
            </div>
          )
        )}

        {selectedId && view === 'tree' && (
          <div className="absolute bottom-6 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-md bg-white p-6 rounded-[32px] shadow-2xl border z-[110] modal-up">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-5">
                <div className={`w-16 h-16 rounded-3xl flex items-center justify-center text-3xl shadow-xl transition-transform hover:scale-110 ${processedNodes[selectedId]?.gender === '女' ? 'bg-rose-500' : 'bg-indigo-600'}`}>
                  {processedNodes[selectedId]?.avatar || (processedNodes[selectedId]?.gender === '女' ? '👩' : '👨')}
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800">{processedNodes[selectedId]?.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-2 py-0.5 bg-slate-100 rounded-full text-slate-500 font-black uppercase">{toChineseGen(processedNodes[selectedId]?.generation)}</span>
                    {getAppellation(selectedId) && <span className="text-xs text-indigo-600 font-bold px-2 py-0.5 bg-indigo-50 rounded-full">{getAppellation(selectedId)}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="p-2 text-slate-300 hover:text-slate-600 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button onClick={() => { setMyId(selectedId); localStorage.setItem(`my_id_${APP_DATA_ID}`, selectedId); }} className={`py-4 rounded-2xl font-black text-sm transition-all ${myId === selectedId ? 'bg-indigo-100 text-indigo-600 ring-4 ring-indigo-50' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <polyline points="16 11 18 13 22 9"></polyline>
                </svg>
                设为本人
              </button>
              {isAdmin && <button onClick={() => {setForm({name: processedNodes[selectedId].name, gender: processedNodes[selectedId].gender, birth: processedNodes[selectedId].birth || '', avatar: processedNodes[selectedId].avatar || ''}); setModalType('edit')}} className="py-4 bg-slate-900 text-white rounded-2xl font-black text-sm active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                修改资料
              </button>}
            </div>

            {isAdmin && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setModalType('add_child')} className="bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-indigo-700">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      添加子女
                    </button>
                    <button onClick={() => setModalType('add_spouse')} className="bg-rose-500 text-white py-4 rounded-2xl font-black text-sm shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-rose-600">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                      </svg>
                      添加配偶
                    </button>
                </div>
                <button onClick={async () => {
                  if(!window.confirm("确定要永久从族谱中删除此成员及其关系吗？")) return;
                  
                  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
                    setError('缺少Supabase环境变量配置');
                    return;
                  }
                  
                  if (!supabaseClient) {
                    setError('Supabase客户端未初始化');
                    return;
                  }
                  
                  try {
                    const { error } = await supabaseClient.from('members').delete().eq('id', selectedId);
                    if (error) {
                      console.error('删除成员失败:', error);
                      setError(`删除成员失败: ${error.message}`);
                      return;
                    }
                    setSelectedId(null);
                  } catch (err) {
                    console.error('删除成员失败:', err);
                    setError(`删除成员失败: ${err.message}`);
                  }
                }} className="w-full py-3 bg-rose-50 text-rose-500 rounded-xl font-black text-xs border border-rose-100 hover:bg-rose-100 transition-colors">永久从族谱删除成员</button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 侧边辅助工具栏 */}
      {view === 'tree' && members.length > 0 && (
        <div className="absolute top-24 right-4 flex flex-col gap-3">
            <button onClick={(e) => handleZoom({ clientX: window.innerWidth/2, clientY: window.innerHeight/2 }, 1)} className="p-3 bg-white rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:bg-slate-50 active:scale-90 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button onClick={(e) => handleZoom({ clientX: window.innerWidth/2, clientY: window.innerHeight/2 }, -1)} className="p-3 bg-white rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:bg-slate-50 active:scale-90 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-45">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button onClick={() => setTransform({ x: window.innerWidth / 2 - 90, y: 150, scale: 0.7 })} className="p-3 bg-indigo-600 rounded-2xl shadow-lg text-white hover:bg-indigo-700 active:scale-90 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="4"></circle>
                <line x1="21.17" y1="8" x2="12" y2="8"></line>
                <line x1="3.95" y1="6.06" x2="8.54" y2="14"></line>
                <line x1="10.88" y1="21.94" x2="15.46" y2="14"></line>
              </svg>
            </button>
            <button onClick={exportCanvas} className="p-3 bg-white rounded-2xl shadow-lg border border-slate-100 text-slate-600 hover:bg-slate-50 active:scale-90 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
        </div>
      )}

      {/* 搜索层 */}
      {modalType === 'search' && (
        <div className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-xl p-4 flex flex-col items-center">
          <div className="w-full max-w-md mt-20">
            <input autoFocus className="w-full p-6 bg-white rounded-[28px] shadow-2xl outline-none font-black text-xl" placeholder="输入姓名或出生年份..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
            <div className="mt-5 bg-white rounded-[24px] overflow-hidden shadow-2xl max-h-[50vh] overflow-y-auto border border-white/50 custom-scrollbar">
              {members.filter(m => m.name.includes(searchQuery)).map(m => (
                <div key={m.id} onClick={() => locateMember(m.id)} className="p-5 border-b flex justify-between items-center hover:bg-indigo-50 cursor-pointer active:bg-indigo-100 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="text-2xl">{m.avatar || (m.gender === '女' ? '👩' : '👨')}</div>
                    <div>
                        <div className="font-black text-slate-800">{m.name} <span className="text-[10px] bg-slate-100 px-2 rounded-full ml-2">{toChineseGen(m.generation)}</span></div>
                        <div className="text-xs text-slate-400 mt-1">{m.birth || '未登记生日'}</div>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              ))}
            </div>
            <button onClick={() => setModalType(null)} className="mt-8 bg-white/20 text-white p-4 rounded-full backdrop-blur-md mx-auto block hover:bg-white/30 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 验证层 */}
      {modalType === 'pwd' && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-xl p-6">
          <div className="w-full max-w-sm bg-white rounded-[40px] p-10 text-center shadow-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-indigo-600 mb-6">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
            <h3 className="text-2xl font-black mb-6">管理员验证</h3>
            <input type="password" autoFocus className="w-full p-5 bg-slate-50 rounded-[24px] text-center text-4xl tracking-[0.8em] outline-none border-4 border-transparent focus:border-indigo-100 transition-all" placeholder="****" onChange={e => e.target.value === '8888' && (setIsAdmin(true), setModalType(null))}/>
          </div>
        </div>
      )}

      {/* 表单层 */}
      {['add_child', 'add_spouse', 'edit', 'add_event', 'add_root'].includes(modalType) && (
        <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-slate-900/40 backdrop-blur-xl p-0 md:p-6">
           <div className="w-full max-w-md bg-white rounded-t-[40px] md:rounded-[32px] p-8 shadow-2xl relative modal-up">
              <button onClick={() => setModalType(null)} className="absolute right-6 top-6 text-slate-300 hover:text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <h3 className="text-xl font-black mb-8 text-slate-800">资料录入</h3>
              <div className="space-y-6">
                {modalType === 'add_event' ? (
                  <div className="space-y-4">
                    <input className="w-full p-4 bg-slate-50 rounded-2xl outline-none font-bold" placeholder="事件标题" value={form.name} onChange={e => setForm({...form, name: e.target.value})}/>
                    <input type="date" className="w-full p-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-500" value={form.date} onChange={e => setForm({...form, date: e.target.value})}/>
                    <textarea className="w-full p-4 bg-slate-50 rounded-2xl h-32 outline-none font-medium text-slate-600 resize-none" placeholder="记录具体详情..." value={form.content} onChange={e => setForm({...form, content: e.target.value})}/>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-4">
                       <div className="w-20">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">自定义头像</label>
                          <input className="w-full p-4 bg-slate-50 rounded-[20px] outline-none font-black text-2xl text-center focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="👴" value={form.avatar} onChange={e => setForm({...form, avatar: e.target.value})}/>
                       </div>
                       <div className="flex-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">成员姓名</label>
                          <input className="w-full p-4 bg-slate-50 rounded-[20px] outline-none font-black text-lg border-2 border-transparent focus:border-indigo-100 focus:bg-white transition-all" placeholder="真实姓名" value={form.name} onChange={e => setForm({...form, name: e.target.value})}/>
                       </div>
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">出生日期</label>
                       <input type="date" className="w-full p-4 bg-slate-50 rounded-[20px] outline-none font-bold text-slate-600 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all" value={form.birth} onChange={e => setForm({...form, birth: e.target.value})}/>
                    </div>
                    <div className="flex gap-3">
                      {['男', '女'].map(g => (
                        <button key={g} onClick={() => setForm({...form, gender: g})} className={`flex-1 py-4 rounded-[20px] font-black text-sm transition-all shadow-lg ${form.gender === g ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{g === '男' ? '♂ 男性' : '♀ 女性'}</button>
                      ))}
                    </div>
                  </>
                )}
                <button onClick={handleAction} className="w-full py-5 bg-indigo-600 text-white rounded-[24px] font-black shadow-xl hover:bg-indigo-700 active:scale-95 transition-all mt-4">确认保存</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}



