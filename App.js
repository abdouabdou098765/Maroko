import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, FlatList, Platform, StatusBar as RNStatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { parseCommand } from './parser';

const KEY = 'maroko.items.v1';
const CHANNEL = 'reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DAY_NAMES = ['الحد', 'التنين', 'التلات', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const pad = (n) => String(n).padStart(2, '0');

function label(ts) {
  const d = new Date(ts);
  const n = new Date();
  const tmr = new Date(n);
  tmr.setDate(n.getDate() + 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  let day;
  if (same(d, n)) day = 'اليوم';
  else if (same(d, tmr)) day = 'غدا';
  else day = `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  return `${day} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function setupNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'تذكيرات ماروكو',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 300, 200, 300],
      lightColor: '#D4A24C',
    });
  }
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function schedule(title, date) {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title: '⏰ ماروكو', body: title, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: CHANNEL,
      },
    });
  } catch (e) {
    return null;
  }
}

const cancel = async (id) => {
  if (!id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch (e) {}
};

const EXAMPLES = [
  'ذكرني نشري الخبز غدا العشية',
  'فكرني نتصل بماما الجمعة على 5 و نص',
  'ذكرني ندير الرياضة بعد ساعة',
  'زيد لي نشري الحليب',
];

export default function App() {
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [notifOk, setNotifOk] = useState(true);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) setItems(JSON.parse(raw));
      } catch (e) {}
      setReady(true);
      const ok = await setupNotifications();
      setNotifOk(ok);
    })();
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
  }, [items, ready]);

  const preview = useMemo(() => (text.trim() ? parseCommand(text) : null), [text]);

  const add = useCallback(async (value) => {
    const p = parseCommand(value);
    if (!p.title) return;
    let notifId = null;
    if (p.date) {
      if (!notifOk) {
        const ok = await setupNotifications();
        setNotifOk(ok);
        if (!ok) {
          Alert.alert('الإشعارات مسدودة', 'خاصك تفعل الإشعارات لماروكو من إعدادات الهاتف باش يذكرك.');
        }
      }
      notifId = await schedule(p.title, p.date);
    }
    setItems((prev) => [
      ...prev,
      { id: String(Date.now()), title: p.title, when: p.date ? p.date.getTime() : null, done: false, notifId },
    ]);
    setText('');
  }, [notifOk]);

  // ---- الصوت: تكلم مع ماروكو ----
  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (ev) => {
    const t = ev.results && ev.results[0] ? ev.results[0].transcript : '';
    setHeard(t);
    if (ev.isFinal && t.trim()) {
      setHeard('');
      add(t);
    }
  });
  useSpeechRecognitionEvent('error', (ev) => {
    setListening(false);
    setHeard('');
    if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      Alert.alert('ما سمعتش مزيان', 'تأكد من الإنترنت ومن تثبيت Google (التعرف على الصوت)، وعاود جرب.');
    }
  });

  const toggleMic = useCallback(async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('الميكروفون مسدود', 'فعل إذن الميكروفون لماروكو من إعدادات الهاتف.');
      return;
    }
    setText('');
    ExpoSpeechRecognitionModule.start({
      lang: 'ar-MA',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
    });
  }, [listening]);

  const toggle = useCallback(async (item) => {
    let notifId = item.notifId;
    if (!item.done) {
      await cancel(item.notifId);
      notifId = null;
    } else if (item.when && item.when > Date.now()) {
      notifId = await schedule(item.title, new Date(item.when));
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done, notifId } : i)));
  }, []);

  const remove = useCallback(async (item) => {
    await cancel(item.notifId);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }, []);

  const clearDone = useCallback(() => {
    setItems((prev) => prev.filter((i) => !i.done));
  }, []);

  const sorted = useMemo(() => {
    const pending = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    pending.sort((a, b) => (a.when ?? Infinity) - (b.when ?? Infinity));
    return [...pending, ...done];
  }, [items]);

  const now = Date.now();

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Text style={s.brand}>ماروكو</Text>
        <Text style={s.sub}>مساعدك المغربي · Maroko</Text>
      </View>

      {sorted.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>جرب تكتب:</Text>
          {EXAMPLES.map((e) => (
            <TouchableOpacity key={e} style={s.chip} onPress={() => setText(e)}>
              <Text style={s.chipText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          ListFooterComponent={
            items.some((i) => i.done) ? (
              <TouchableOpacity onPress={clearDone} style={s.clear}>
                <Text style={s.clearText}>مسح المنجز</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => {
            const overdue = !item.done && item.when && item.when < now;
            return (
              <View style={[s.card, item.done && { opacity: 0.45 }]}>
                <TouchableOpacity onPress={() => toggle(item)} style={[s.check, item.done && s.checkOn]}>
                  {item.done ? <Text style={s.tick}>✓</Text> : null}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={[s.title, item.done && { textDecorationLine: 'line-through' }]}>{item.title}</Text>
                  {item.when ? (
                    <Text style={[s.when, overdue && { color: '#E5675B' }]}>
                      {label(item.when)}{overdue ? ' · فات' : ''}
                    </Text>
                  ) : (
                    <Text style={s.when}>بلا موعد</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => remove(item)} hitSlop={10}>
                  <Text style={s.del}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      <View style={s.bar}>
        {listening ? (
          <Text style={s.preview}>🎙️ كنسمعك… {heard}</Text>
        ) : null}
        {!listening && preview && preview.title ? (
          <Text style={s.preview}>
            {preview.date ? `⏰ ${label(preview.date.getTime())} — ` : '📝 '}
            {preview.title}
          </Text>
        ) : null}
        <View style={s.inputRow}>
          <TouchableOpacity style={s.send} onPress={() => add(text)}>
            <Text style={s.sendText}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.mic, listening && s.micOn]} onPress={toggleMic}>
            <Text style={s.micText}>{listening ? '■' : '🎙'}</Text>
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="كتب ولا ضغط على 🎙 وهضر…"
            placeholderTextColor="#6B7385"
            onSubmitEditing={() => add(text)}
            returnKeyType="send"
          />
        </View>
      </View>
    </View>
  );
}

const GOLD = '#D4A24C';
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D12', paddingTop: RNStatusBar.currentHeight || 40 },
  header: { paddingHorizontal: 20, paddingVertical: 14 },
  brand: { color: GOLD, fontSize: 34, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  sub: { color: '#6B7385', fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  empty: { flex: 1, padding: 20, alignItems: 'flex-end' },
  emptyTitle: { color: '#9AA3B5', fontSize: 15, marginBottom: 10, writingDirection: 'rtl' },
  chip: { backgroundColor: '#151922', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, alignSelf: 'stretch', borderWidth: 1, borderColor: '#202636' },
  chipText: { color: '#D7DCE8', fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  card: { flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: '#151922', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#202636' },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: GOLD, marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: GOLD },
  tick: { color: '#0B0D12', fontWeight: '900' },
  title: { color: '#F2F4F8', fontSize: 17, textAlign: 'right', writingDirection: 'rtl' },
  when: { color: '#2BB3A3', fontSize: 13, marginTop: 3, textAlign: 'right', writingDirection: 'rtl' },
  del: { color: '#6B7385', fontSize: 18, paddingHorizontal: 8 },
  clear: { alignSelf: 'center', padding: 10 },
  clearText: { color: '#6B7385' },
  bar: { padding: 12, borderTopWidth: 1, borderTopColor: '#202636', backgroundColor: '#0E1118' },
  preview: { color: GOLD, fontSize: 13, marginBottom: 8, textAlign: 'right', writingDirection: 'rtl' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#151922', color: '#F2F4F8', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, textAlign: 'right', writingDirection: 'rtl', borderWidth: 1, borderColor: '#202636' },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  mic: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#1F8A8A', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  micOn: { backgroundColor: '#E5675B' },
  micText: { color: '#fff', fontSize: 20 },
  sendText: { color: '#0B0D12', fontSize: 26, fontWeight: '700', marginTop: -2 },
});
