'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { AppShell,Topbar } from '../components';
import { api } from '@/lib/api';
import type { Topic } from '@/types';
const tones=['v','m','p','v','m','p'];
export default function TopicsPage(){const[topics,setTopics]=useState<Topic[]>([]);const[loading,setLoading]=useState(true);useEffect(()=>{api.getTopics().then(setTopics).catch(()=>setTopics([])).finally(()=>setLoading(false));},[]);return <AppShell><Topbar eyebrow="Библиотека тем" title="Выбери, что обсудим сегодня"/><div className="section-heading" style={{marginTop:0}}><div><h2>{topics.length||15} тем для практики</h2><p>От простых мнений до настоящих турнирных столкновений.</p></div><Link className="button secondary" href="/rounds">Мои раунды</Link></div>{loading?<div className="panel">Загружаем темы...</div>:<div className="course-grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))'}}>{topics.map((topic,i)=><Link className="course" href={`/rounds/new?topic=${topic.id}`} key={topic.id}><div className={`course-art ${tones[i%tones.length]}`}>{['◒','⌁','◈','✦','◉','⌬'][i%6]}</div><div className="course-body"><strong>{topic.title}</strong><small>{topic.description}</small><div className="course-meta"><span>{topic.category}</span><b>{topic.difficulty}</b></div></div></Link>)}</div>}</AppShell>}
