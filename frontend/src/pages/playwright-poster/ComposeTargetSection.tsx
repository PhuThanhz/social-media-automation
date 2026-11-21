import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Select,
  Tag,
  Tooltip,
  Alert,
  Popconfirm,
  InputNumber,
  Switch,
  App,
  TimePicker,
  Segmented,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  AppstoreOutlined,
  SendOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SettingOutlined,
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  TeamOutlined,
  ReloadOutlined,
  SyncOutlined,
  EditOutlined,
  KeyOutlined,
  CloseOutlined,
  ThunderboltFilled,
  SafetyCertificateOutlined,
  FileTextOutlined,
  ShareAltOutlined,
  SaveOutlined,
  UserOutlined,
  DeploymentUnitOutlined,
  EyeInvisibleOutlined,
  BulbOutlined,
  BarChartOutlined,
  AimOutlined,
} from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { SocialAccount, PostMode } from './types';

interface ComposeTargetSectionProps {
  form: FormInstance<any>;
  postMode: PostMode;
  groupStaggerInterval: number;
  setGroupStaggerInterval: React.Dispatch<React.SetStateAction<number>>;
  groupTimingMode: 'SPREAD_DAY' | 'STAGGER';
  setGroupTimingMode: React.Dispatch<React.SetStateAction<'SPREAD_DAY' | 'STAGGER'>>;
  groupSpreadStart: Dayjs;
  setGroupSpreadStart: React.Dispatch<React.SetStateAction<Dayjs>>;
  groupSpreadEnd: Dayjs;
  setGroupSpreadEnd: React.Dispatch<React.SetStateAction<Dayjs>>;
  validLinkCount: number;
  setQuickCookieModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickCookieTargetId: React.Dispatch<React.SetStateAction<number>>;
  playwrightAccounts: SocialAccount[];
  personalAccountTargets: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  pageCountByCUser: Map<string, number>;
  viaNameOf: (account: SocialAccount) => string;
  coAdminViasByPageName: Map<string, string[]>;
  groupAccountsWithId: SocialAccount[];
  selectedTargetAccount: SocialAccount;
  isCurrentTargetExpired: boolean;
  hasMultipleGroupsSelected: boolean;
  setIsMultiDistributeActive: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiSelectedTargets: React.Dispatch<React.SetStateAction<string[]>>;
  setDistributionStrategy: React.Dispatch<React.SetStateAction<"ROUND_ROBIN" | "DAILY_QUOTA" | "STAGGERED">>;
  distributionStrategy: "ROUND_ROBIN" | "DAILY_QUOTA" | "STAGGERED";
  staggerIntervalMinutes: number;
  setStaggerIntervalMinutes: React.Dispatch<React.SetStateAction<number>>;
  isAnonymous: boolean;
  setIsAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupDistributionMode: React.Dispatch<React.SetStateAction<"PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL">>;
  groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL";
  activeSelectedGroupIds: string[];
  activeSelectedFanpageIds: string[];
  validPersonalVias: SocialAccount[];
  twoMainVias: SocialAccount[];
  twoMainViasDisplayNames: string;
  isTwoViaActive: boolean;
  handleQuickSelectTwoVias: () => void;
  handleQuickSelectAllVias: () => void;
  handleQuickSelectAllPages: () => void;
  selectedCoAdminPageNames: string[];
  isAllCoAdminsSelected: boolean;
  handleAutoSelectBothViasForSelectedPages: () => void;
  handleResetToSingleTarget: () => void;
  savedPresets: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }[];
  selectedPresetId: string;
  setSelectedPresetId: React.Dispatch<React.SetStateAction<string>>;
  setSavePresetModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewPresetName: React.Dispatch<React.SetStateAction<string>>;
  setManagePresetsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingPreset: React.Dispatch<React.SetStateAction<{ id: string; name: string; }>>;
  setEditingPresetName: React.Dispatch<React.SetStateAction<string>>;
  applyPreset: (preset: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }) => void;
  handleUpdatePresetWithCurrent: (presetId: string) => void;
  handleDeletePreset: (presetId: string, e?: React.MouseEvent<Element, MouseEvent>) => void;
  handleAutoSpreadPagesForGroups: () => void;
  unifiedAccountOptions: any[];
  unifiedGroupOptions: { value: string; filterLabel: string; label: React.JSX.Element; }[];
  calculatedTotalQueueCount: number;
  setGroupCheckModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

// Bước "Chọn nơi xuất bản" của form soạn bài — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
export default function ComposeTargetSection({
  form,
  postMode,
  groupStaggerInterval,
  setGroupStaggerInterval,
  groupTimingMode,
  setGroupTimingMode,
  groupSpreadStart,
  setGroupSpreadStart,
  groupSpreadEnd,
  setGroupSpreadEnd,
  validLinkCount,
  setQuickCookieModalOpen,
  setQuickCookieTargetId,
  playwrightAccounts,
  personalAccountTargets,
  accountTargetValue,
  pageCountByCUser,
  viaNameOf,
  coAdminViasByPageName,
  groupAccountsWithId,
  selectedTargetAccount,
  isCurrentTargetExpired,
  hasMultipleGroupsSelected,
  setIsMultiDistributeActive,
  setMultiSelectedTargets,
  setDistributionStrategy,
  distributionStrategy,
  staggerIntervalMinutes,
  setStaggerIntervalMinutes,
  isAnonymous,
  setIsAnonymous,
  setGroupDistributionMode,
  groupDistributionMode,
  activeSelectedGroupIds,
  activeSelectedFanpageIds,
  validPersonalVias,
  twoMainVias,
  twoMainViasDisplayNames,
  isTwoViaActive,
  handleQuickSelectTwoVias,
  handleQuickSelectAllVias,
  handleQuickSelectAllPages,
  selectedCoAdminPageNames,
  isAllCoAdminsSelected,
  handleAutoSelectBothViasForSelectedPages,
  handleResetToSingleTarget,
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
  unifiedAccountOptions,
  unifiedGroupOptions,
  calculatedTotalQueueCount,
  setGroupCheckModalVisible,
}: ComposeTargetSectionProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
  }, [queryClient]);
  return (
    <section id="poster-step-2" className="poster-form-section">
      <div className="poster-section-heading">
        <span className="poster-step-number">2</span>
        <div>
          <h2>Chọn nơi xuất bản</h2>
        </div>
      </div>

      {/* Cảnh báo nổi bật khi Fanpage đang chọn bị hết hạn Cookie */}
      {isCurrentTargetExpired && (
        <Alert
          type="error"
          showIcon
          message={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-semibold text-red-400">
                Fanpage <b>{selectedTargetAccount?.pageName || selectedTargetAccount?.platformAccountId}</b> đang <b>BỊ HẾT HẠN COOKIE</b>! Bài đăng chắc chắn sẽ bị lỗi nếu không cập nhật cookie mới.
              </span>
              <Button
                type="primary"
                danger
                size="small"
                icon={<KeyOutlined />}
                onClick={() => {
                  setQuickCookieTargetId(selectedTargetAccount?.id);
                  setQuickCookieModalOpen(true);
                }}
                className="font-extrabold text-xs rounded-lg h-8 px-3 shadow-md shrink-0 self-start sm:self-auto"
              >
                Cập Nhật Cookie Ngay
              </Button>
            </div>
          }
          className="rounded-2xl border-red-500/30 bg-red-950/40 mb-4 shadow-sm"
        />
      )}

      {/* THANH COMBO THƯỜNG DÙNG (SPEED PRESETS BAR) */}
      <div className="poster-preset-bar">
        {/* Khối chọn cấu hình */}
        <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
            <AppstoreOutlined className="text-xs" />
          </div>
          <span className="text-xs font-semibold text-slate-300 shrink-0">Cấu hình lưu sẵn:</span>
          <Select
            value={selectedPresetId}
            placeholder={savedPresets.length === 0 ? "Chưa có cấu hình nào được lưu" : "Chọn cấu hình để áp dụng nhanh..."}
            className="poster-preset-select"
            size="middle"
            allowClear
            disabled={savedPresets.length === 0}
            onChange={(val) => {
              setSelectedPresetId(val || null);
              const matched = savedPresets.find((p) => p.id === val);
              if (matched) applyPreset(matched);
            }}
            optionRender={(option) => {
              const p = savedPresets.find((item) => item.id === option.value);
              if (!p) return option.label;
              return (
                <div className="flex items-center justify-between gap-2 py-0.5 group">
                  <span className="truncate text-[13px] font-medium text-slate-100">
                    {p.name} <span className="text-slate-300 font-normal">({p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • {p.selectedFanpageIds.length} page)</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Đổi tên cấu hình">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined className="text-xs text-sky-400" />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPreset({ id: p.id, name: p.name });
                          setEditingPresetName(p.name);
                        }}
                        className="!p-1 h-7 w-7 text-slate-300 hover:text-white hover:bg-slate-700"
                      />
                    </Tooltip>
                    <Tooltip title="Xóa cấu hình">
                      <Popconfirm
                        title="Xóa cấu hình này?"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDeletePreset(p.id);
                        }}
                        okText="Xóa"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true, size: 'small' }}
                        cancelButtonProps={{ size: 'small' }}
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={<DeleteOutlined className="text-xs text-rose-400" />}
                          onClick={(e) => e.stopPropagation()}
                          className="!p-1 h-7 w-7 text-slate-300 hover:text-rose-300 hover:bg-rose-950/40"
                        />
                      </Popconfirm>
                    </Tooltip>
                  </div>
                </div>
              );
            }}
            options={savedPresets.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • ${p.selectedFanpageIds.length} page)`,
            }))}
          />

          {/* Khi đang chọn một preset, hiển thị nút Cập nhật nhanh với thiết lập hiện tại */}
          {selectedPresetId && (
            <Tooltip title="Lưu các Nhóm và Page đang tick chọn hiện tại vào cấu hình này">
              <Button
                size="middle"
                icon={<SaveOutlined className="text-emerald-400 text-xs" />}
                onClick={() => handleUpdatePresetWithCurrent(selectedPresetId)}
                className="text-xs font-semibold rounded-lg bg-emerald-950/40 border-emerald-600/50 text-emerald-300 hover:text-white hover:bg-emerald-800/60 shrink-0"
              >
                Cập nhật
              </Button>
            </Tooltip>
          )}
        </div>

        {/* Khối các nút hành động */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeSelectedGroupIds.length > 0 && (
            <Button
              size="middle"
              icon={<SendOutlined className="text-sky-400 text-xs" />}
              onClick={handleAutoSpreadPagesForGroups}
              className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
              title="Tự động bốc số Page bằng đúng số lượng nhóm đã chọn"
            >
              Rải Page đều Nhóm
            </Button>
          )}
          <Tooltip title="Xem, sửa tên, cập nhật hoặc xóa các cấu hình đã lưu">
            <Button
              size="middle"
              icon={<SettingOutlined className="text-slate-300 text-xs" />}
              onClick={() => setManagePresetsModalOpen(true)}
              className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
            >
              Quản lý cấu hình
            </Button>
          </Tooltip>
          <Button
            type="primary"
            size="middle"
            icon={<PlusOutlined />}
            onClick={() => {
              if (activeSelectedGroupIds.length === 0 && activeSelectedFanpageIds.length === 0) {
                message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi lưu!');
                return;
              }
              setNewPresetName(`Combo ${activeSelectedGroupIds.length} Nhóm • ${activeSelectedFanpageIds.length} Page`);
              setSavePresetModalOpen(true);
            }}
            className="text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-sm shrink-0"
          >
            Lưu mới
          </Button>
        </div>
      </div>

      {/* BƯỚC 2: KHUNG ĐIỀU KHIỂN XUẤT BẢN */}
      <div className="space-y-4">
        {/* Lưới 2 cột trực quan: Cột trái chọn Nhóm, Cột phải chọn Người đăng */}
        <div className={postMode !== 'FANPAGE_ONLY' ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 items-start' : 'space-y-4'}>
          {/* NẾU LÀ GROUP_ONLY HOẶC FANPAGE_AND_GROUP: HIỂN THỊ KHUNG CHỌN NHÓM ĐẦU TIÊN ĐỂ LUỒNG TỰ NHIÊN HƠN */}
          {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-emerald-500/30 shadow-xl backdrop-blur-md">
              <div className="space-y-3.5">
                <div className="flex items-start sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-sm shadow-sm shrink-0">
                      <TeamOutlined />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <span className="whitespace-nowrap">Nhóm nhận bài</span>
                        <span className={`text-xs font-semibold ${activeSelectedGroupIds.length > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>
                          {activeSelectedGroupIds.length}/{groupAccountsWithId.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="small"
                      icon={<ReloadOutlined className="text-sky-400" />}
                      onClick={() => {
                        queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
                        message.success('Đã tải lại danh sách nhóm mới nhất!');
                      }}
                      className="rounded-xl h-8 w-8 shrink-0"
                      title="Làm mới danh sách nhóm"
                      aria-label="Làm mới danh sách nhóm"
                    />
                    <Button
                      size="small"
                      icon={<SafetyCertificateOutlined className="text-emerald-400" />}
                      onClick={() => setGroupCheckModalVisible(true)}
                      className="rounded-xl h-8 w-8 shrink-0"
                      title="Kiểm tra nhóm"
                      aria-label="Kiểm tra nhóm"
                    />
                  </div>
                </div>

                <Form.Item
                  name={postMode === 'GROUP_ONLY' ? 'targetGroupId' : 'groupNames'}
                  rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nhóm nhận bài' }]}
                  className="!mb-0"
                >
                  <Select
                    mode="multiple"
                    size="large"
                    placeholder="Tìm nhóm theo tên hoặc ID"
                    showSearch
                    allowClear
                    optionFilterProp="filterLabel"
                    filterOption={(input, option: any) => {
                      const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                      const query = input.toLowerCase();
                      if (label.includes(query)) return true;
                      const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                      return strip(label).includes(strip(query));
                    }}
                    className="w-full"
                    options={unifiedGroupOptions}
                  />
                </Form.Item>

                {unifiedGroupOptions.length === 0 && (
                  <div className="mt-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs text-emerald-200">
                    <span>Chưa có Nhóm Facebook nào trong danh sách. Hãy vào <b>Quản lý Nhóm</b> để khai báo các nhóm cần đăng.</span>
                    <Button size="small" type="primary" href="/groups" className="bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold shrink-0">
                      Khai báo Nhóm ngay →
                    </Button>
                  </div>
                )}
              </div>

              {/* Đăng ẩn danh (chỉ với GROUP_ONLY) */}
              {postMode === 'GROUP_ONLY' && (
                <div className="mt-4 pt-2">
                  <div className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${isAnonymous
                      ? 'bg-amber-950/25 border-amber-500/40 shadow-sm'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                    }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 border transition-colors ${isAnonymous
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800/80 border-slate-700/60 text-slate-400'
                        }`}>
                        <EyeInvisibleOutlined />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold flex items-center gap-2 flex-wrap">
                          <span className={isAnonymous ? 'text-amber-200' : 'text-slate-100'}>
                            Đăng ẩn danh vào Group
                          </span>
                          {isAnonymous ? (
                            <Tag color="warning" className="!rounded-full !text-xs font-bold !m-0 !px-2 border-0 bg-amber-500/20 text-amber-300">
                              Ẩn danh tính {selectedTargetAccount?.pageName ? selectedTargetAccount.pageName.replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1') : 'Nick cá nhân'}
                            </Tag>
                          ) : (
                            <span className="text-xs text-slate-300 font-normal">
                              Thành viên ẩn danh
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-300 truncate">
                          Xuất bản bài dưới tư cách "Thành viên ẩn danh", bảo vệ danh tính tài khoản thật.
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={isAnonymous}
                      onChange={(checked) => setIsAnonymous(checked)}
                      className={isAnonymous ? '!bg-amber-500' : ''}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        {/* KHUNG CHỌN TÀI KHOẢN ĐẠI DIỆN ĐĂNG BÀI */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-sky-500/30 shadow-xl space-y-4 backdrop-blur-md">
          {/* Header: Tiêu đề & Trạng thái phân bổ đang kích hoạt + Nút reset */}
            <div className="flex items-start sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 text-sm shadow-sm shrink-0">
                  <ShareAltOutlined />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <span className="whitespace-nowrap">
                      {postMode === 'FANPAGE_ONLY'
                        ? 'Tài khoản đăng'
                        : postMode === 'FANPAGE_AND_GROUP'
                        ? 'Fanpage đăng bài'
                        : 'Tài khoản đăng'}
                    </span>
                    {activeSelectedFanpageIds.length > 0 && (
                      <span className="text-xs font-semibold text-sky-300 whitespace-nowrap">
                        {isTwoViaActive ? '2 Via' : activeSelectedFanpageIds.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>

            </div>

          {postMode === 'GROUP_ONLY' && (
            <div className="text-xs text-slate-400 flex items-center gap-2 select-none">
              <BulbOutlined className="text-sky-400 shrink-0" />
              <span>Nhóm không cho Page đăng thì tự chuyển sang nick cá nhân.</span>
            </div>
          )}

          {/* Chọn nhanh: một hàng chip cùng kiểu, chữ ngắn */}
          {(() => {
            const chip = (on: boolean) =>
              `h-7 px-3 rounded-lg text-xs font-semibold transition-colors border cursor-pointer whitespace-nowrap ${
                on
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/50'
                  : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:bg-slate-700 hover:text-white'
              }`;
            const hasCoAdminPages = playwrightAccounts.some((a) => {
              const norm = (a.pageName || a.platformAccountId).trim().toLowerCase();
              return (coAdminViasByPageName.get(norm) || []).length > 1 && a.tokenStatus !== 'EXPIRED';
            });
            const selectCoAdminPages = () => {
              const sharedVals = playwrightAccounts
                .filter((a) => {
                  const norm = (a.pageName || a.platformAccountId).trim().toLowerCase();
                  const coAdmins = coAdminViasByPageName.get(norm) || [];
                  return coAdmins.length > 1 && a.tokenStatus !== 'EXPIRED';
                })
                .map((a) => accountTargetValue(a));
              if (sharedVals.length === 0) {
                message.warning('Không tìm thấy Page đồng quản trị nào!');
                return;
              }
              form.setFieldValue('targetFanpageId', sharedVals);
              setIsMultiDistributeActive(true);
              setMultiSelectedTargets(sharedVals);
              setDistributionStrategy('ROUND_ROBIN');
              setGroupDistributionMode('PAGE_PER_GROUP');
              message.success('Đã bật chia bài cho các Page có nhiều Via đồng quản trị');
            };
            return (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToSingleTarget}
                  className={chip(activeSelectedFanpageIds.length === 1 && !isTwoViaActive)}
                  title="Đăng bằng 1 tài khoản"
                >
                  1 tài khoản
                </button>
                {playwrightAccounts.length > 0 && (
                  <button
                    type="button"
                    onClick={handleQuickSelectAllPages}
                    className={chip(false)}
                    title={`Chia đều bài cho ${playwrightAccounts.length} Fanpage`}
                  >
                    Tất cả Page ({playwrightAccounts.length})
                  </button>
                )}
                {validPersonalVias.length > 0 && (
                  <button
                    type="button"
                    onClick={handleQuickSelectAllVias}
                    className={chip(false)}
                    title={`Chia đều bài cho ${validPersonalVias.length} Nick Via`}
                  >
                    Tất cả Via ({validPersonalVias.length})
                  </button>
                )}
                {validPersonalVias.length >= 2 && (
                  <button
                    type="button"
                    onClick={handleQuickSelectTwoVias}
                    className={chip(isTwoViaActive)}
                    title="2 Nick Via chạy song song, chống spam"
                  >
                    2 Via song song
                  </button>
                )}
                {hasCoAdminPages && (
                  <button
                    type="button"
                    onClick={selectCoAdminPages}
                    className={chip(false)}
                    title="Chọn các Page có nhiều Via cùng quản trị để chia bài song song"
                  >
                    Co-Admin
                  </button>
                )}
              </div>
            );
          })()}

          {/* Dòng 2: Ô Select tìm kiếm thông minh */}
          <div>
            <Form.Item
              name="targetFanpageId"
              rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nơi xuất bản' }]}
              className="!mb-0"
            >
              <Select
                mode="multiple"
                size="large"
                placeholder="Gõ tên Page hoặc Nick cá nhân để tìm kiếm và chọn nhanh..."
                showSearch
                allowClear
                optionFilterProp="filterLabel"
                filterOption={(input, option: any) => {
                  const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                  const query = input.toLowerCase();
                  if (label.includes(query)) return true;
                  const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                  return strip(label).includes(strip(query));
                }}
                tagRender={(tagProps) => {
                  const { value, closable, onClose } = tagProps;
                  const acc = playwrightAccounts.find((a) => accountTargetValue(a) === value) ||
                              personalAccountTargets.find((a) => accountTargetValue(a) === value);
                  const name = acc ? (acc.pageName || acc.platformAccountId) : String(value);
                  const isPersonal = acc?.platform === 'FACEBOOK_PROFILE' || acc?.platform === 'FACEBOOK_PERSONAL';
                  const viaName = acc ? viaNameOf(acc) : '';
                  const normName = name.trim().toLowerCase();
                  const coAdmins = coAdminViasByPageName.get(normName) || [];
                  const isCoAdmin = coAdmins.length > 1;

                  return (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 mr-2 my-1 whitespace-nowrap">
                      {isPersonal ? <UserOutlined className="text-slate-400 text-xs" /> : <FileTextOutlined className="text-slate-400 text-xs" />}
                      <span className="font-semibold text-slate-100">{name}</span>
                      {isCoAdmin && (
                        <span className="text-xs font-semibold text-purple-300" title="Trang có nhiều Nick Via cùng quản trị">
                          Co-Admin
                        </span>
                      )}
                      {viaName && <span className="text-xs font-normal text-slate-400" title={`Đăng qua ${viaName}`}>· {viaName}</span>}
                      {closable && (
                        <CloseOutlined
                          onClick={onClose}
                          className="text-slate-300 hover:text-rose-400 text-xs ml-0.5 cursor-pointer transition-colors"
                        />
                      )}
                    </span>
                  );
                }}
                onChange={(vals) => {
                  const list = Array.isArray(vals) ? vals : [vals];
                  setIsMultiDistributeActive(list.length > 1);
                  setMultiSelectedTargets(list);
                  if (list.length > 1) {
                    setGroupDistributionMode('PAGE_PER_GROUP');
                  }
                }}
                className="w-full"
                options={unifiedAccountOptions}
              />
            </Form.Item>

            {unifiedAccountOptions.length === 0 && (
              <div className="mt-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-between gap-3 text-xs text-blue-200">
                <span>Chưa có Fanpage hoặc Nick Via cá nhân nào kết nối. Vui lòng vào <b>Quản lý kết nối</b> để thêm tài khoản trước khi đăng.</span>
                <Button size="small" type="primary" href="/connections" className="bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold shrink-0">
                  Thêm kết nối ngay →
                </Button>
              </div>
            )}

            {/* Báo hiệu và nút hỗ trợ thông minh khi chọn Page đồng quản trị (Co-admin) */}
            {selectedCoAdminPageNames.length > 0 && !isAllCoAdminsSelected && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <span>
                  <b>{selectedCoAdminPageNames.join(', ')}</b> có 2 Via quản lý.
                </span>
                <button type="button" onClick={handleAutoSelectBothViasForSelectedPages} className="text-sky-300 hover:underline cursor-pointer font-semibold">
                  Chạy song song
                </button>
              </div>
            )}

            {selectedCoAdminPageNames.length > 0 && isAllCoAdminsSelected && (
              <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircleOutlined />
                <span>
                  Song song 2 Via cho <b>{selectedCoAdminPageNames.join(', ')}</b>
                </span>
                <button type="button" onClick={handleResetToSingleTarget} className="text-slate-400 hover:text-white hover:underline cursor-pointer">
                  Tắt
                </button>
              </div>
            )}
          </div>
        </div>

          {/* Tự động hiện cấu hình phân phối đa kênh khi FANPAGE_ONLY và chọn nhiều tài khoản */}
          {postMode === 'FANPAGE_ONLY' && activeSelectedFanpageIds.length > 1 && (
            <div className="p-4 bg-slate-950/70 rounded-xl border border-indigo-900/60 space-y-3">
              <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-indigo-300">
                <span className="flex items-center gap-2">
                  <ThunderboltFilled className="text-amber-400" /> Cài đặt phân phối bài cho {activeSelectedFanpageIds.length} tài khoản:
                </span>
                <Tag color="cyan" className="!rounded-full font-bold text-xs !m-0">TỰ ĐỘNG CHIA BÀI</Tag>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Thuật toán phân chia nội dung:
                  </label>
                  <Select
                    size="middle"
                    value={distributionStrategy}
                    onChange={(val) => setDistributionStrategy(val)}
                    className="w-full"
                    options={[
                      { value: 'ROUND_ROBIN', label: 'Xoay vòng đều (Bài 1 → Kênh A, Bài 2 → Kênh B...)' },
                      { value: 'DAILY_QUOTA', label: 'Cân bằng theo chỉ tiêu ngày (Ưu tiên kênh thiếu bài)' },
                    ]}
                  />
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Chế độ phân bổ Nhóm & Page linh hoạt khi chọn N Nhóm và N Page */}
        {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && activeSelectedGroupIds.length > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-700/80 bg-slate-900/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
                  <DeploymentUnitOutlined className="text-base" />
                </div>
                <span className="text-sm font-bold text-slate-100 whitespace-nowrap">Chia Page vào {activeSelectedGroupIds.length} Nhóm</span>
              </div>
              <Segmented
                value={groupDistributionMode}
                onChange={(v) => setGroupDistributionMode(v as typeof groupDistributionMode)}
                className="shrink-0"
                options={[
                  { value: 'PAGE_PER_GROUP', label: '1 Page / Nhóm', title: 'Mỗi nhóm 1 Page, các Page luân phiên (khuyên dùng)' },
                  { value: 'ROUND_ROBIN_POSTS', label: 'Xoay vòng', title: 'Mỗi bài chỉ vào 1 nhóm, xoay vòng các nhóm' },
                  { value: 'CROSS_ALL', label: 'Tất cả × Tất cả', title: 'Mỗi bài được mọi Page đăng vào mọi nhóm' },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                {groupDistributionMode === 'PAGE_PER_GROUP'
                  ? `Mỗi bài vào đủ ${activeSelectedGroupIds.length} nhóm, chia đều qua ${Math.max(1, activeSelectedFanpageIds.length)} Page`
                  : groupDistributionMode === 'ROUND_ROBIN_POSTS'
                    ? `Mỗi bài vào 1 nhóm, xoay vòng ${activeSelectedGroupIds.length} nhóm`
                    : `Mỗi bài do ${Math.max(1, activeSelectedFanpageIds.length)} Page đăng vào ${activeSelectedGroupIds.length} nhóm`}
              </span>
              <span className={groupDistributionMode === 'CROSS_ALL' ? 'text-amber-300' : 'text-slate-300'}>
                {validLinkCount || 0} bài → {calculatedTotalQueueCount} lượt đăng
              </span>
            </div>

            {/* Cấu hình phân bổ thời gian cho Nhóm: Rải đều cả ngày vs Cuốn chiếu nối đuôi */}
            {hasMultipleGroupsSelected && (
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 text-purple-300">
                      <ClockCircleOutlined className="text-sm" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Giờ đăng giữa các nhóm</div>
                    </div>
                  </div>

                  <Segmented
                    size="small"
                    value={groupTimingMode}
                    onChange={(v) => setGroupTimingMode(v as typeof groupTimingMode)}
                    className="self-start sm:self-auto shrink-0"
                    options={[
                      { value: 'SPREAD_DAY', label: 'Rải đều', title: 'Rải đều các nhóm trong khung giờ' },
                      { value: 'STAGGER', label: `Nối đuôi (${groupStaggerInterval}p)`, title: 'Nối đuôi nhau, cách nhau vài phút' },
                    ]}
                  />
                </div>

                {groupTimingMode === 'SPREAD_DAY' ? (
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-purple-500/20 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-purple-200">
                        <span className="font-semibold text-slate-300">Khung giờ rải:</span>
                        <span>Từ</span>
                        <TimePicker
                          format="HH:mm"
                          size="small"
                          value={groupSpreadStart}
                          onChange={(t) => t && setGroupSpreadStart(t)}
                          className="w-24 bg-slate-900 border-purple-500/30"
                        />
                        <span>Đến</span>
                        <TimePicker
                          format="HH:mm"
                          size="small"
                          value={groupSpreadEnd}
                          onChange={(t) => t && setGroupSpreadEnd(t)}
                          className="w-24 bg-slate-900 border-purple-500/30"
                        />
                      </div>

                      <div className="flex items-center gap-1 text-xs">
                        <Button
                          size="small"
                          type="text"
                          className="!text-xs !px-2 !h-7 text-purple-300 hover:text-white"
                          onClick={() => {
                            setGroupSpreadStart(dayjs().startOf('day').add(8, 'hour').add(30, 'minute'));
                            setGroupSpreadEnd(dayjs().startOf('day').add(22, 'hour').add(30, 'minute'));
                          }}
                        >
                          Cả ngày (08:30 - 22:30)
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          className="!text-xs !px-2 !h-7 text-purple-300 hover:text-white"
                          onClick={() => {
                            setGroupSpreadStart(dayjs().add(5, 'minute'));
                            setGroupSpreadEnd(dayjs().add(6, 'hour'));
                          }}
                        >
                          6 tiếng tới
                        </Button>
                      </div>
                    </div>

                    {(() => {
                      const numGroups = Math.max(1, activeSelectedGroupIds.length);
                      const postCount = Math.max(1, validLinkCount || 1);
                      const totalSpanMins = Math.max(30, groupSpreadEnd.diff(groupSpreadStart, 'minute'));
                      const avgGapMins = Math.max(20, Math.floor(totalSpanMins / Math.max(1, postCount)));
                      const hours = Math.floor(avgGapMins / 60);
                      const mins = avgGapMins % 60;
                      const gapText = hours > 0 ? `${hours}h${mins > 0 ? `${mins}p` : ''}` : `${mins} phút`;
                      return (
                        <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-500/20 px-3 py-2 rounded-lg flex items-center gap-1.5">
                          <CheckCircleOutlined className="text-emerald-400 shrink-0" />
                          <span>
                            Dự kiến: <b>{postCount} bài</b> rải đều cho <b>{numGroups} nhóm</b> từ {groupSpreadStart.format('HH:mm')} đến {groupSpreadEnd.format('HH:mm')}.
                            {numGroups === 1
                              ? ` Mỗi bài cách nhau ~${gapText} (an toàn tuyệt đối cho nhóm).`
                              : ` Trung bình cách ~${gapText}/bài, cùng 1 nhóm đảm bảo tối thiểu 20 phút.`}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-purple-500/30 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-purple-200 shrink-0">
                          Giãn cách bài:
                        </span>
                        {[10, 15, 20, 30, 60].map((mins) => {
                          const active = groupStaggerInterval === mins;
                          return (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => setGroupStaggerInterval(mins)}
                              className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                                active
                                  ? 'bg-purple-600/30 border-purple-400 text-purple-200 ring-1 ring-purple-500/40 shadow-sm font-bold'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'
                              }`}
                            >
                              {mins}p {mins === 20 ? '⭐ Khuyên dùng' : ''}
                            </button>
                          );
                        })}
                        <InputNumber
                          min={1}
                          max={1440}
                          value={groupStaggerInterval}
                          onChange={(val) => setGroupStaggerInterval(val || 20)}
                          addonAfter="phút/bài"
                          className="w-28 !text-xs"
                          size="small"
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 italic flex items-center gap-1">
                      <span>💡 Mỗi bài đăng vào Nhóm cách nhau <b>{groupStaggerInterval} phút</b> (khuyên dùng 20p để tránh bị Facebook đánh dấu spam hoặc admin nhóm chặn).</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
