import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { type FormInstance, App } from 'antd';
import type { SocialAccount, PostMode } from './types';
import { stripEmojiPrefix } from './shared';
import api from '../../config/axios';

interface PresetHubParams {
  DEFAULT_HUYNH_THANH_PHU_PRESET?: any;
  setPostMode: React.Dispatch<React.SetStateAction<PostMode>>;
  setGroupDistributionMode: React.Dispatch<React.SetStateAction<"PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL">>;
  setIsAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  postingIdentities: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  setIsMultiDistributeActive: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiSelectedTargets: React.Dispatch<React.SetStateAction<string[]>>;
  form: FormInstance<any>;
  activeSelectedGroupIds: string[];
  activeSelectedFanpageIds: string[];
  postMode: PostMode;
  groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL";
  isAnonymous: boolean;
  playwrightAccounts: SocialAccount[];
  groupAccountsWithId?: SocialAccount[];
}

// Cấu hình thường dùng (preset): lưu, áp dụng, cập nhật, xoá — tách từ PlaywrightPoster (state và hàm giữ nguyên, chỉ chuyển chỗ)
export function usePresetHub({ DEFAULT_HUYNH_THANH_PHU_PRESET, setPostMode, setGroupDistributionMode, setIsAnonymous, postingIdentities, accountTargetValue, setIsMultiDistributeActive, setMultiSelectedTargets, form, activeSelectedGroupIds, activeSelectedFanpageIds, postMode, groupDistributionMode, isAnonymous, playwrightAccounts, groupAccountsWithId = [] }: PresetHubParams) {
  const { message } = App.useApp();
  // --- HỆ THỐNG COMBO THƯỜNG DÙNG (PRESET HUB) ---
  const [savedPresets, setSavedPresets] = useState<Array<{
    id: string;
    name: string;
    postMode: 'GROUP_ONLY' | 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP';
    groupDistributionMode: 'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL';
    selectedFanpageIds: string[];
    selectedGroupIds: string[];
    isAnonymous?: boolean;
  }>>(() => {
    try {
      const raw = localStorage.getItem('autopost_preset_combos');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((p) => !p.id?.includes('huynh-thanh-phu'));
        }
      }
    } catch { }
    return [];
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [managePresetsModalOpen, setManagePresetsModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<{ id: string; name: string } | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');

  // Hàm đồng bộ vĩnh viễn cấu hình vào cả LocalStorage và Database (SQLite / Postgres)
  const persistPresets = (nextPresets: any[]) => {
    try {
      localStorage.setItem('autopost_preset_combos', JSON.stringify(nextPresets));
    } catch { }
    api.post('/settings/autopost_preset_combos', { value: JSON.stringify(nextPresets) }).catch(() => {});
  };

  // Tự động tải cấu hình vĩnh viễn từ Database khi mở app, đồng thời sao lưu nếu DB chưa có
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get('/settings/autopost_preset_combos');
        const dbVal = res.data?.value;
        if (active && dbVal) {
          try {
            const parsed = typeof dbVal === 'string' ? JSON.parse(dbVal) : dbVal;
            if (Array.isArray(parsed) && parsed.length > 0) {
              const clean = parsed.filter((p: any) => !p.id?.includes('huynh-thanh-phu'));
              setSavedPresets(clean);
              try {
                localStorage.setItem('autopost_preset_combos', JSON.stringify(clean));
              } catch { }
              return;
            }
          } catch { }
        }
        const localRaw = localStorage.getItem('autopost_preset_combos');
        if (localRaw) {
          api.post('/settings/autopost_preset_combos', { value: localRaw }).catch(() => {});
        }
      } catch { }
    })();
    return () => { active = false; };
  }, []);

  const applyPreset = useCallback((preset: {
    id: string;
    name: string;
    postMode: 'GROUP_ONLY' | 'FANPAGE_ONLY' | 'FANPAGE_AND_GROUP';
    groupDistributionMode: 'PAGE_PER_GROUP' | 'ROUND_ROBIN_POSTS' | 'CROSS_ALL';
    selectedFanpageIds: string[];
    selectedGroupIds: string[];
    isAnonymous?: boolean;
  }) => {
    setSelectedPresetId(preset.id);
    setPostMode(preset.postMode);
    setGroupDistributionMode(preset.groupDistributionMode || 'PAGE_PER_GROUP');
    setIsAnonymous(!!preset.isAnonymous);

    // Chuẩn hóa và ánh xạ selectedFanpageIds khớp chính xác với postingIdentities đang active
    const resolvedFanpageIds = preset.selectedFanpageIds.map((target) => {
      const match = postingIdentities.find(
        (a) =>
          accountTargetValue(a) === target ||
          a.platformAccountId === target ||
          target.startsWith(`${a.platformAccountId}:`) ||
          String(a.id) === target
      );
      return match ? accountTargetValue(match) : target;
    });

    setIsMultiDistributeActive(resolvedFanpageIds.length > 1);
    setMultiSelectedTargets(resolvedFanpageIds);

    // Chuẩn hóa và ánh xạ selectedGroupIds khớp chính xác với groupAccountsWithId đang active
    const resolvedGroupIds = (preset.selectedGroupIds || []).map((target) => {
      const match = (groupAccountsWithId || []).find(
        (g) =>
          g.platformAccountId === target ||
          String(g.id) === target ||
          (g.platformAccountId && String(g.platformAccountId) === String(target)) ||
          stripEmojiPrefix(g.pageName) === target
      );
      return match ? match.platformAccountId : String(target);
    });

    // Nếu cấu hình có sẵn nhóm thì ghi đè, nếu rỗng thì giữ nguyên nhóm user đã tích (nếu có)
    const currentGroups = form.getFieldValue('targetGroupId') || form.getFieldValue('groupNames') || [];
    const newGroups = resolvedGroupIds.length > 0
      ? resolvedGroupIds
      : (Array.isArray(currentGroups) ? currentGroups : (currentGroups ? [currentGroups] : []));

    const applyFields = () => {
      form.setFieldsValue({
        targetFanpageId: resolvedFanpageIds.length === 1 ? resolvedFanpageIds[0] : resolvedFanpageIds,
        targetGroupId: newGroups,
        groupNames: newGroups,
      });
    };

    applyFields();
    // Bổ sung timeout để khi DOM Form.Item nhóm mount xong (do postMode đổi từ FANPAGE_ONLY sang GROUP_ONLY),
    // giá trị nhóm được điền lại chuẩn xác 100%, không bao giờ bị rớt về 0 nhóm
    setTimeout(applyFields, 50);
    setTimeout(applyFields, 150);

    if (newGroups.length === 0) {
      message.success(`⭐ Đã chọn cấu hình "${preset.name}" (${resolvedFanpageIds.length} page)! Bạn hãy chọn nhóm yêu thích để đăng nhé.`);
    } else {
      message.success(`⭐ Đã kích hoạt Combo "${preset.name}" (${newGroups.length} nhóm • ${resolvedFanpageIds.length} page)!`);
    }
  }, [postingIdentities, groupAccountsWithId, form, message]);

  const handleUpdatePresetWithCurrent = useCallback((presetId: string) => {
    const groupIds = activeSelectedGroupIds;
    const fanpageIds = activeSelectedFanpageIds;
    if (groupIds.length === 0 && fanpageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi cập nhật cấu hình!');
      return;
    }
    setSavedPresets((prev) => {
      const next = prev.map((p) => {
        if (p.id === presetId) {
          return {
            ...p,
            postMode,
            groupDistributionMode,
            // Giữ nguyên nhóm cũ nếu user chưa tick nhóm mới, tránh bị xóa mất nhóm ngoài ý muốn
            selectedGroupIds: groupIds.length > 0 ? groupIds : p.selectedGroupIds,
            selectedFanpageIds: fanpageIds.length > 0 ? fanpageIds : p.selectedFanpageIds,
            isAnonymous,
          };
        }
        return p;
      });
      persistPresets(next);
      return next;
    });
    message.success('✅ Đã cập nhật cấu hình bằng danh sách Nhóm & Page đang chọn hiện tại!');
  }, [activeSelectedGroupIds, activeSelectedFanpageIds, postMode, groupDistributionMode, isAnonymous, message]);

  const handleRenamePreset = useCallback((presetId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      message.warning('Tên cấu hình không được để trống!');
      return;
    }
    setSavedPresets((prev) => {
      const next = prev.map((p) => (p.id === presetId ? { ...p, name: trimmed } : p));
      persistPresets(next);
      return next;
    });
    setEditingPreset(null);
    setEditingPresetName('');
    message.success('✅ Đã đổi tên cấu hình thành công!');
  }, [message]);

  const handleDeletePreset = useCallback((presetId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSavedPresets((prev) => {
      const next = prev.filter((p) => p.id !== presetId);
      persistPresets(next);
      return next;
    });
    if (selectedPresetId === presetId) {
      setSelectedPresetId(null);
    }
    message.info('Đã xóa cấu hình khỏi danh sách.');
  }, [selectedPresetId, message]);

  const handleSaveNewPreset = useCallback(() => {
    const groupIds = activeSelectedGroupIds;
    const fanpageIds = activeSelectedFanpageIds;
    if (groupIds.length === 0 && fanpageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi lưu!');
      return;
    }
    const name = newPresetName.trim() || `Combo ${groupIds.length} Nhóm • ${fanpageIds.length} Page`;
    const newPreset = {
      id: `preset-${Date.now()}`,
      name,
      postMode,
      groupDistributionMode,
      selectedGroupIds: groupIds,
      selectedFanpageIds: fanpageIds,
      isAnonymous,
    };
    setSavedPresets((prev) => {
      const next = [...prev, newPreset];
      persistPresets(next);
      return next;
    });
    setSavePresetModalOpen(false);
    setNewPresetName('');
    message.success(`⭐ Đã lưu Combo "${name}" thành công!`);
  }, [activeSelectedGroupIds, activeSelectedFanpageIds, newPresetName, postMode, groupDistributionMode, isAnonymous, message]);

  const handleAutoSpreadPagesForGroups = useCallback(() => {
    if (activeSelectedGroupIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 nhóm trước khi rải Page!');
      return;
    }
    const n = Math.max(1, activeSelectedGroupIds.length);
    const available = playwrightAccounts.map((a) => accountTargetValue(a));
    if (available.length === 0) {
      message.warning('Chưa có Fanpage nào được kết nối!');
      return;
    }
    const picked = available.slice(0, n);
    form.setFieldValue('targetFanpageId', picked);
    setMultiSelectedTargets(picked);
    setIsMultiDistributeActive(picked.length > 1);
    setGroupDistributionMode('PAGE_PER_GROUP');
    message.success(`⚡ Đã tự động rải đều ${picked.length} Page cho ${activeSelectedGroupIds.length} Nhóm!`);
  }, [activeSelectedGroupIds, playwrightAccounts, form, message]);

  return {
    savePresetModalOpen,
    managePresetsModalOpen,
    savedPresets,
    selectedPresetId,
    setSelectedPresetId,
    setSavePresetModalOpen,
    setNewPresetName,
    setManagePresetsModalOpen,
    setEditingPreset,
    setEditingPresetName,
    applyPreset,
    handleUpdatePresetWithCurrent,
    handleDeletePreset,
    handleAutoSpreadPagesForGroups,
    newPresetName,
    handleSaveNewPreset,
    editingPreset,
    handleRenamePreset,
    editingPresetName,
  };
}
