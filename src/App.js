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

// 检查URL格式
if (SUPABASE_URL && !SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.startsWith('http://')) {
  console.error('Supabase URL 必须以 https:// 开头');
}

// 全局Supabase客户端实例
let globalSupabaseInstance = null;

const APP_DATA_ID = 'genealogy-stable-v2'; 

const toChineseGen = (n) => {
  const map = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return n <= 12 ? `第 ${map[n]} 代` : `第 ${n} 代`;
};

// 创建一个独立的Supabase管理类来避免多实例问题
class SupabaseManager {
  constructor() {
    this.supabase = null;
    this.initialized = false;
    this.listeners = [];
  }

  async initialize() {
    if (this.initialized) {
      return this.supabase;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('缺少Supabase环境变量配置');
    }

    if (!SUPABASE_URL.startsWith('https://')) {
      throw new Error('Supabase URL 必须以 https:// 开头');
    }

    try {
      const { createClient } = await import('@supabase/supabase-js');
      this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this.initialized = true;
      return this.supabase;
    } catch (err) {
      console.error('初始化Supabase客户端失败:', err);
      throw new Error(`初始化Supabase客户端失败: ${err.message}`);
    }
  }

  getSupabase() {
    if (!this.initialized) {
      console.warn('Supabase尚未初始化');
      return null;
    }
    return this.supabase;
  }

  async fetchData() {
    if (!this.initialized) {
      await this.initialize();
    }

    const supabase = this.getSupabase();
    if (!supabase) {
      throw new Error('Supabase客户端未初始化');
    }

    // 获取成员数据
    let { data: membersData, error: membersError } = await supabase
      .from('members')
      .select('*')
      .eq('app_id', APP_DATA_ID);
    
    if (membersError) {
      console.error('获取成员数据失败:', membersError);
      throw new Error(`获取成员数据失败: ${membersError.message}`);
    }

    // 获取事件数据并按时间倒序排序
    let { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('app_id', APP_DATA_ID)
      .order('date', { ascending: false });
    
    if (eventsError) {
      console.error('获取事件数据失败:', eventsError);
      throw new Error(`获取事件数据失败: ${eventsError.message}`);
    }

    return {
      members: membersData || [],
      events: eventsData || []
    };
  }

  setupListeners(setMembers, setEvents) {
    if (!this.initialized) {
      console.warn('Supabase尚未初始化');
      return () => {};
    }

    const supabase = this.getSupabase();
    if (!supabase) {
      return () => {};
    }

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

    // 返回清理函数
    return () => {
      if (membersChannel) {
        supabase.removeChannel(membersChannel);
      }
      if (eventsChannel) {
        supabase.removeChannel(eventsChannel);
      }
    };
  }
}

// 创建全局Supabase管理器实例
const supabaseManager = new SupabaseManager();

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
  const [isSubmitting, setIsSubmitting] = useState(false); // 新增提交状态

  const canvasRef = useRef(null);

  useEffect(() => {
    injectStyles();
  }, []);

  // 初始化Supabase
  useEffect(() => {
    let cleanupFn = null;

    const initAndFetchData = async () => {
      try {
        // 初始化Supabase
        await supabaseManager.initialize();
        
        // 获取初始数据
        const { members, events } = await supabaseManager.fetchData();
        setMembers(members);
        setEvents(events);
        
        // 设置监听器
        cleanupFn = supabaseManager.setupListeners(setMembers, setEvents);
      } catch (err) {
        console.error('初始化失败:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    initAndFetchData();

    // 清理函数
    return () => {
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, []);

  // 添加根成员函数 - 优化版本
  const addRootMember = async () => {
    if (isSubmitting) return; // 防止重复提交
    
    setIsSubmitting(true);
    setError(null);
    
    const supabase = supabaseManager.getSupabase();
    if (!supabase) {
      setError('Supabase客户端未初始化');
      setIsSubmitting(false);
      return;
    }

    try {
      // 检查是否已经有根成员
      const { data: existingRoot, error: queryError } = await supabase
        .from('members')
        .select('*')
        .eq('app_id', APP_DATA_ID)
        .eq('generation', 1)
        .limit(1);

      if (queryError) {
        throw new Error(queryError.message);
      }

      if (existingRoot && existingRoot.length > 0) {
        setError('根成员已存在，无法添加多个根成员');
        setIsSubmitting(false);
        return;
      }

      // 添加根成员
      const { data: newMember, error: insertError } = await supabase
        .from('members')
        .insert([{
          name: form.name,
          gender: form.gender,
          birth: form.birth,
          avatar: form.avatar,
          generation: 1,
          app_id: APP_DATA_ID,
          father_id: null,
          mother_id: null,
          is_spouse_of: null
        }])
        .select()
        .single();

      if (insertError) {
        console.error('插入根成员失败:', insertError);
        if (insertError.code === '42501') {
          setError('插入失败：数据库权限不足。请检查Supabase的Row Level Security (RLS)策略配置。您需要在Supabase控制台中为members表设置适当的插入权限。');
        } else {
          setError(`添加根成员失败: ${insertError.message}`);
        }
        setIsSubmitting(false);
        return;
      }

      // 立即将新成员添加到本地状态
      setMembers(prev => [...prev, newMember]);
      
      // 重置表单
      setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
      setModalType(null);
      
      // 显示成功提示
      alert('根成员添加成功！');
    } catch (error) {
      console.error('添加根成员异常:', error);
      setError(`添加根成员异常: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 添加成员函数
  const addMember = async (parentId, isSpouse = false) => {
    if (isSubmitting) return; // 防止重复提交
    
    setIsSubmitting(true);
    setError(null);
    
    const supabase = supabaseManager.getSupabase();
    if (!supabase) {
      setError('Supabase客户端未初始化');
      setIsSubmitting(false);
      return;
    }

    try {
      // 获取父成员信息以确定代数
      const parentMember = members.find(m => m.id === parentId);
      if (!parentMember) {
        setError('找不到父成员');
        setIsSubmitting(false);
        return;
      }

      // 准备新成员数据
      const newMemberData = {
        name: form.name,
        gender: form.gender,
        birth: form.birth,
        avatar: form.avatar,
        generation: isSpouse ? parentMember.generation : parentMember.generation + 1,
        app_id: APP_DATA_ID,
        father_id: isSpouse ? null : parentId,
        mother_id: null,
        is_spouse_of: isSpouse ? parentId : null
      };

      // 插入新成员
      const { data: newMember, error: insertError } = await supabase
        .from('members')
        .insert([newMemberData])
        .select()
        .single();

      if (insertError) {
        console.error('插入成员失败:', insertError);
        if (insertError.code === '42501') {
          setError('插入失败：数据库权限不足。请检查Supabase的Row Level Security (RLS)策略配置。您需要在Supabase控制台中为members表设置适当的插入权限。');
        } else {
          setError(`添加成员失败: ${insertError.message}`);
        }
        setIsSubmitting(false);
        return;
      }

      // 立即将新成员添加到本地状态
      setMembers(prev => [...prev, newMember]);
      
      // 重置表单
      setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
      setModalType(null);
      
      // 显示成功提示
      alert(isSpouse ? '配偶添加成功！' : '子女添加成功！');
    } catch (error) {
      console.error('添加成员异常:', error);
      setError(`添加成员异常: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 添加事件函数
  const addEvent = async () => {
    if (isSubmitting) return; // 防止重复提交
    
    setIsSubmitting(true);
    setError(null);
    
    const supabase = supabaseManager.getSupabase();
    if (!supabase) {
      setError('Supabase客户端未初始化');
      setIsSubmitting(false);
      return;
    }

    try {
      // 准备事件数据
      const eventData = {
        content: form.content,
        date: form.date,
        related_member_ids: selectedId ? [selectedId].join(',') : '',
        app_id: APP_DATA_ID
      };

      // 插入新事件
      const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert([eventData])
        .select()
        .single();

      if (insertError) {
        console.error('插入事件失败:', insertError);
        if (insertError.code === '42501') {
          setError('插入失败：数据库权限不足。请检查Supabase的Row Level Security (RLS)策略配置。您需要在Supabase控制台中为events表设置适当的插入权限。');
        } else {
          setError(`添加事件失败: ${insertError.message}`);
        }
        setIsSubmitting(false);
        return;
      }

      // 立即将新事件添加到本地状态（保持时间倒序）
      setEvents(prev => [newEvent, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
      
      // 重置表单
      setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
      setModalType(null);
      
      // 显示成功提示
      alert('事件添加成功！');
    } catch (error) {
      console.error('添加事件异常:', error);
      setError(`添加事件异常: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 编辑成员函数
  const editMember = async () => {
    if (isSubmitting) return; // 防止重复提交
    
    setIsSubmitting(true);
    setError(null);
    
    const supabase = supabaseManager.getSupabase();
    if (!supabase) {
      setError('Supabase客户端未初始化');
      setIsSubmitting(false);
      return;
    }

    try {
      // 更新成员信息
      const { data: updatedMember, error: updateError } = await supabase
        .from('members')
        .update({
          name: form.name,
          gender: form.gender,
          birth: form.birth,
          avatar: form.avatar
        })
        .eq('id', selectedId)
        .select()
        .single();

      if (updateError) {
        console.error('更新成员失败:', updateError);
        if (updateError.code === '42501') {
          setError('更新失败：数据库权限不足。请检查Supabase的Row Level Security (RLS)策略配置。');
        } else {
          setError(`更新成员失败: ${updateError.message}`);
        }
        setIsSubmitting(false);
        return;
      }

      // 更新本地状态
      setMembers(prev => prev.map(m => m.id === selectedId ? updatedMember : m));
      
      // 重置表单
      setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
      setModalType(null);
      
      // 显示成功提示
      alert('成员信息更新成功！');
    } catch (error) {
      console.error('更新成员异常:', error);
      setError(`更新成员异常: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

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
      currentGen.sort((a, b) => (nodes[a.father_id]?.x || 0) - (nodes[b.father_id]?.x || 0));

      const mainOnes = currentGen.filter(m => !m.is_spouse_of);
      const spouses = currentGen.filter(m => m.is_spouse_of);
      
      let totalW = mainOnes.reduce((acc, m) => {
        const hasS = spouses.some(s => s.is_spouse_of === m.id);
        return acc + (hasS ? CARD_W * 2 + 15 : CARD_W);
      }, 0) + (mainOnes.length - 1) * GAP_X;

      let startX = -totalW / 2;
      mainOnes.forEach(m => {
        nodes[m.id] = { ...m, x: startX, y: (genNum - 1) * GEN_H };
        const sp = spouses.find(s => s.is_spouse_of === m.id);
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
    if (t.is_spouse_of === myId) return isF ? "妻子" : "丈夫";
    if (me.is_spouse_of === tid) return isF ? "妻子" : "丈夫";

    if (diff === 1) {
      if (t.father_id === me.id || (me.is_spouse_of && t.father_id === me.is_spouse_of)) return isF ? "女儿" : "儿子";
      if (t.is_spouse_of) {
        const spouseNode = processedNodes[t.is_spouse_of];
        if (spouseNode && (spouseNode.father_id === me.id || (me.is_spouse_of && spouseNode.father_id === me.is_spouse_of))) return isF ? "儿媳" : "女婿";
      }
      return isF ? "侄女/外甥女" : "侄子/外甥";
    }

    if (diff === 0) {
      if (t.father_id === me.father_id && t.father_id) return isF ? "姐妹" : "兄弟";
      const meF = processedNodes[me.father_id], tF = processedNodes[t.father_id];
      if (meF && tF && meF.father_id === tF.father_id) return isF ? "堂姐妹" : "堂兄弟";
      return "同辈";
    }

    if (diff === -1) {
      if (t.id === me.father_id || t.is_spouse_of === me.father_id) return isF ? "母亲" : "父亲";
      const meF = processedNodes[me.father_id];
      if (meF && t.father_id === meF.father_id) return isF ? "姑姑" : (t.x < meF.x ? "伯父" : "叔父");
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
      x: mouseX - (mouseX - prev.x) * zoomFactor,
      y: mouseY - (mouseY - prev.y) * zoomFactor,
      scale: newScale
    }));
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      }));
      setMoveCount(c => c + 1);
    }
  };

  const handleMouseUp = (e) => {
    if (isDragging && moveCount < 5) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - transform.x) / transform.scale;
      const y = (e.clientY - rect.top - transform.y) / transform.scale;
      const clickedNode = Object.values(processedNodes).find(n => 
        x >= n.x && x <= n.x + 180 && y >= n.y && y <= n.y + 100
      );
      if (clickedNode) setSelectedId(clickedNode.id);
    }
    setIsDragging(false);
    setMoveCount(0);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - transform.x, y: e.touches[0].clientY - transform.y });
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setInitialDist(dist);
    }
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      setTransform(prev => ({
        ...prev,
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y
      }));
    } else if (e.touches.length === 2 && initialDist) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = Math.min(Math.max(currentDist / initialDist * transform.scale, 0.15), 3);
      setTransform(prev => ({ ...prev, scale }));
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    handleZoom(e, e.deltaY);
  };

  const renderTree = () => {
    if (!canvasRef.current) return null;
    
    const ctx = canvasRef.current.getContext('2d');
    const devicePixelRatio = window.devicePixelRatio || 1;
    const canvas = canvasRef.current;
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== displayWidth * devicePixelRatio || canvas.height !== displayHeight * devicePixelRatio) {
      canvas.width = displayWidth * devicePixelRatio;
      canvas.height = displayHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // 绘制连接线
    Object.entries(processedNodes).forEach(([id, node]) => {
      if (node.father_id) {
        const father = processedNodes[node.father_id];
        if (father) {
          ctx.strokeStyle = '#94A3B8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(father.x + 90, father.y + 100);
          ctx.lineTo(node.x + 90, node.y);
          ctx.stroke();
        }
      }
      if (node.mother_id) {
        const mother = processedNodes[node.mother_id];
        if (mother) {
          ctx.strokeStyle = '#94A3B8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(mother.x + 90, mother.y + 100);
          ctx.lineTo(node.x + 90, node.y);
          ctx.stroke();
        }
      }
      // 绘制配偶关系
      if (node.is_spouse_of) {
        const spouse = processedNodes[node.is_spouse_of];
        if (spouse) {
          ctx.strokeStyle = '#E2E8F0';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(spouse.x + 180, spouse.y + 50);
          ctx.lineTo(node.x, node.y + 50);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });

    // 绘制节点
    Object.entries(processedNodes).forEach(([id, node]) => {
      const isSelected = selectedId === id;
      const isMe = myId === id;
      
      // 节点背景
      ctx.fillStyle = isSelected ? '#FDE68A' : isMe ? '#BFDBFE' : node.gender === '女' ? '#FECACA' : '#BFDBFE';
      ctx.fillRect(node.x, node.y, 180, 100);
      
      // 边框
      ctx.strokeStyle = isSelected ? '#D97706' : isMe ? '#1E40AF' : '#64748B';
      ctx.lineWidth = isSelected ? 3 : 1;
      ctx.strokeRect(node.x, node.y, 180, 100);
      
      // 头像
      if (node.avatar) {
        const img = new Image();
        img.src = node.avatar;
        img.onload = () => {
          ctx.drawImage(img, node.x + 10, node.y + 10, 40, 40);
        };
      }
      
      // 姓名
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 14px system-ui';
      ctx.fillText(node.name, node.x + 60, node.y + 25);
      
      // 性别和生日
      ctx.fillStyle = '#64748B';
      ctx.font = '12px system-ui';
      ctx.fillText(`${node.gender} | ${node.birth || '未知'}`, node.x + 60, node.y + 45);
      
      // 代数
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px system-ui';
      ctx.fillText(toChineseGen(node.generation), node.x + 10, node.y + 95);
      
      // 配偶标识
      if (node.is_spouse_of) {
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('♀', node.x + 160, node.y + 15);
      }
    });

    ctx.restore();
  };

  useEffect(() => {
    if (Object.keys(processedNodes).length > 0) {
      renderTree();
    }
  }, [transform, processedNodes, selectedId, myId]);

  if (loading) {
    return (
      <div className="w-full h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* 错误提示 */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md">
          <span className="block sm:inline">{error}</span>
          <button 
            onClick={() => setError(null)}
            className="absolute top-1 right-1 text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {/* 顶部导航栏 */}
      <nav className="glass-nav fixed top-0 left-0 right-0 h-14 flex items-center px-4 z-40 shadow-sm">
        <div className="flex-1 flex space-x-1">
          <button 
            onClick={() => setView('tree')} 
            className={`px-3 py-1 rounded-lg text-sm font-medium ${view === 'tree' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            族谱树
          </button>
          <button 
            onClick={() => setView('list')} 
            className={`px-3 py-1 rounded-lg text-sm font-medium ${view === 'list' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            成员列表
          </button>
          <button 
            onClick={() => setView('timeline')} 
            className={`px-3 py-1 rounded-lg text-sm font-medium ${view === 'timeline' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            时间轴
          </button>
        </div>
        
        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="搜索成员..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-lg text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            onClick={() => setModalType('addRoot')}
            className="bg-blue-500 text-white px-3 py-1 rounded-lg text-sm font-medium hover:bg-blue-600"
          >
            添加根成员
          </button>
        </div>
      </nav>

      {/* 主内容区域 */}
      {view === 'tree' && (
        <div className="absolute inset-0 pt-14">
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => { setIsDragging(false); setInitialDist(null); }}
          />
          
          {selectedId && processedNodes[selectedId] && (
            <div className="fixed bottom-4 left-4 right-4 bg-white rounded-xl shadow-lg p-4 max-w-sm mx-auto z-30">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-lg">{processedNodes[selectedId].name}</h3>
                  <p className="text-gray-600 text-sm">
                    {getAppellation(selectedId) || `${processedNodes[selectedId].gender} | ${toChineseGen(processedNodes[selectedId].generation)}`}
                  </p>
                  <p className="text-gray-500 text-sm">出生: {processedNodes[selectedId].birth || '未知'}</p>
                </div>
                <button 
                  onClick={() => setSelectedId(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 flex space-x-2">
                <button 
                  onClick={() => setModalType('addChild')}
                  className="flex-1 bg-blue-100 text-blue-700 py-2 rounded-lg text-sm font-medium hover:bg-blue-200"
                >
                  添加子女
                </button>
                <button 
                  onClick={() => setModalType('addSpouse')}
                  className="flex-1 bg-green-100 text-green-700 py-2 rounded-lg text-sm font-medium hover:bg-green-200"
                >
                  添加配偶
                </button>
                <button 
                  onClick={() => setModalType('edit')}
                  className="flex-1 bg-yellow-100 text-yellow-700 py-2 rounded-lg text-sm font-medium hover:bg-yellow-200"
                >
                  编辑
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'list' && (
        <div className="pt-14 h-full custom-scrollbar overflow-y-auto p-4">
          <h2 className="text-xl font-bold mb-4">成员列表</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members
              .filter(m => !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(member => (
                <div 
                  key={member.id} 
                  className={`border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow ${
                    selectedId === member.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  onClick={() => locateMember(member.id)}
                >
                  <div className="flex items-center">
                    {member.avatar && (
                      <img src={member.avatar} alt={member.name} className="w-12 h-12 rounded-full mr-3" />
                    )}
                    <div>
                      <h3 className="font-semibold">{member.name}</h3>
                      <p className="text-gray-600 text-sm">{member.gender} | {member.birth || '未知'}</p>
                      <p className="text-gray-500 text-xs">{toChineseGen(member.generation)}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {view === 'timeline' && (
        <div className="pt-14 h-full custom-scrollbar overflow-y-auto p-4">
          <h2 className="text-xl font-bold mb-4">时间轴</h2>
          <div className="space-y-4">
            {events
              .filter(e => !searchQuery || e.content.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(event => (
                <div key={event.id} className="border-l-4 border-blue-500 pl-4 py-1">
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold">{event.content}</h3>
                      <span className="text-gray-500 text-sm">{new Date(event.date).toLocaleDateString()}</span>
                    </div>
                    {event.related_member_ids && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {event.related_member_ids.split(',').map(id => {
                          const member = members.find(m => m.id === id);
                          return member ? (
                            <span 
                              key={id} 
                              className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded cursor-pointer hover:bg-blue-200"
                              onClick={() => locateMember(id)}
                            >
                              {member.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 模态框 */}
      {modalType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end z-50">
          <div className="w-full bg-white rounded-t-xl p-4 modal-up max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                {modalType === 'addRoot' && '添加根成员'}
                {modalType === 'addChild' && '添加子女'}
                {modalType === 'addSpouse' && '添加配偶'}
                {modalType === 'edit' && '编辑成员'}
                {modalType === 'addEvent' && '添加大事件'}
              </h3>
              <button 
                onClick={() => { setModalType(null); setError(null); setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' }); }}
                className="text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            
            {error && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            <div className="space-y-4">
              {(modalType === 'addRoot' || modalType === 'addChild' || modalType === 'addSpouse' || modalType === 'edit') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({...form, name: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="请输入姓名"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">性别</label>
                      <select
                        value={form.gender}
                        onChange={(e) => setForm({...form, gender: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="男">男</option>
                        <option value="女">女</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">出生日期</label>
                      <input
                        type="date"
                        value={form.birth}
                        onChange={(e) => setForm({...form, birth: e.target.value})}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">头像链接</label>
                    <input
                      type="text"
                      value={form.avatar}
                      onChange={(e) => setForm({...form, avatar: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://example.com/avatar.jpg"
                    />
                  </div>
                </>
              )}
              
              {(modalType === 'addEvent') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">事件内容</label>
                    <textarea
                      value={form.content}
                      onChange={(e) => setForm({...form, content: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                      placeholder="请输入事件描述"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({...form, date: e.target.value})}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
              
              <div className="flex space-x-3 pt-4">
                <button
                  onClick={async () => {
                    if (isSubmitting) return; // 防止重复点击
                    
                    if (modalType === 'addRoot') {
                      await addRootMember();
                    } else if (modalType === 'addChild' && selectedId) {
                      await addMember(selectedId, false);
                    } else if (modalType === 'addSpouse' && selectedId) {
                      await addMember(selectedId, true);
                    } else if (modalType === 'edit' && selectedId) {
                      await editMember();
                    } else if (modalType === 'addEvent') {
                      await addEvent();
                    }
                  }}
                  disabled={isSubmitting}
                  className={`flex-1 py-3 rounded-lg font-medium ${
                    isSubmitting 
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {isSubmitting ? '提交中...' : (modalType === 'edit' ? '保存' : '添加')}
                </button>
                
                <button
                  onClick={() => { 
                    setModalType(null); 
                    setError(null); 
                    setForm({ name: '', gender: '男', birth: '', avatar: '', date: '', content: '' });
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-lg font-medium hover:bg-gray-300"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
