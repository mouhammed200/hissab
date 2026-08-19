'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';
import type { NormalizedAllocation, NormalizedItem, NormalizedRecord, RecordTotals } from '@/lib/records/normalize';
import { createClient } from '@/lib/supabase/client';

// Record shape and totals are defined once, in the shared normalizer, so the
// card can never disagree with what the posting route will actually write.
export type ParsedItem = NormalizedItem
export type ParsedRecord = NormalizedRecord
export type { RecordTotals }

interface RecordCardProps {
  /** Needed to look up the org's bank account list for the payment picker. */
  orgId: string;
  record: ParsedRecord;
  totals?: RecordTotals;
  status: 'pending' | 'confirmed' | 'voided' | 'editing';
  /** Blocking problems. Confirmation is disabled while any are present. */
  errors?: string[];
  /** Non-blocking notices, e.g. a rebuilt lump-sum line or a missing TRN. */
  warnings?: string[];
  onConfirm: () => void;
  /** Called with a reason when voiding a confirmed (posted) record; called with no argument when dismissing a still-pending draft. */
  onVoid: (reason?: string) => void;
  onEdit: () => void;
  onSaveEdit: (updated: ParsedRecord) => void;
  onCancelEdit: () => void;
  /** False for viewer-role members; hides the void action on a confirmed record. */
  canVoid?: boolean;
}

const formatCurrency = (amount: number, currency: string = 'AED') => {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(amount) + ` ${currency}`;
};

export default function RecordCard({
  orgId,
  record,
  totals,
  status,
  errors = [],
  warnings = [],
  onConfirm,
  onVoid,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  canVoid = true
}: RecordCardProps) {
  const { t, locale } = useLocale();
  const [editRecord, setEditRecord] = useState<ParsedRecord>(record);
  useEffect(() => setEditRecord(record), [record]);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  // Bank accounts are a small controlled org-level list set up by an
  // accountant — chat extraction only supplies a free-text name (if any),
  // never an id, so the card resolves the real list here and lets the user
  // pick from it rather than guessing.
  const [bankAccounts, setBankAccounts] = useState<{ id: string; accountName: string; label: string }[]>([]);
  useEffect(() => {
    if (record.type !== 'payment' || !orgId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setBankAccounts(
          data.map((a: { id: string; bank_name: string; account_name: string }) => ({
            id: a.id,
            accountName: a.account_name,
            label: `${a.account_name} — ${a.bank_name}`,
          })),
        );
      });
    return () => { cancelled = true; };
  }, [orgId, record.type]);

  // Picking a bank account writes straight through onSaveEdit even outside
  // edit mode: it's a required field the model can never fill in reliably,
  // so it behaves like part of the base card rather than something gated
  // behind the Edit button.
  const handleBankAccountChange = (accountName: string) => {
    onSaveEdit({ ...record, bankAccountName: accountName || undefined });
  };

  const getIconAndLabel = () => {
    switch (record.type) {
      case 'sale': return { icon: '💰', label: locale === 'ar' ? 'مبيعات' : 'Sale' };
      case 'purchase': return { icon: '🛒', label: locale === 'ar' ? 'مشتريات' : 'Purchase' };
      case 'employee': return { icon: '👤', label: locale === 'ar' ? 'موظف' : 'Employee' };
      case 'asset': return { icon: '🏢', label: locale === 'ar' ? 'أصل ثابت' : 'Fixed Asset' };
      case 'relatedParty': return { icon: '🔗', label: locale === 'ar' ? 'طرف ذو صلة' : 'Related Party' };
      case 'payment': return { icon: '💵', label: locale === 'ar' ? 'دفعة' : 'Payment' };
      default: return { icon: '📄', label: locale === 'ar' ? 'سجل' : 'Record' };
    }
  };

  const { icon, label } = getIconAndLabel();
  const isEditing = status === 'editing';
  const isVoided = status === 'voided';
  
  // The old fallback rendered a nameless sale as "General", which looked like a
  // legitimate record. Missing counterparties are now called out as missing.
  const missingPartyLabel =
    record.type === 'sale'
      ? locale === 'ar'
        ? 'عميل غير محدد'
        : 'Customer not specified'
      : record.type === 'purchase'
        ? locale === 'ar'
          ? 'مورد غير محدد'
          : 'Supplier not specified'
        : record.type === 'payment'
          ? t('record.counterpartyFallback')
          : locale === 'ar'
            ? 'غير مسمى'
            : 'Unnamed';

  const partyDisplayName =
    record.party ||
    record.name ||
    record.assetName ||
    missingPartyLabel;

  const isSaleOrPurchase = record.type === 'sale' || record.type === 'purchase';
  const hasItems = Boolean(record.items && record.items.length > 0);
  const blocking = errors.length > 0;

  const handleItemChange = (index: number, field: keyof ParsedItem, value: any) => {
    const newItems = [...(editRecord.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };
    setEditRecord({ ...editRecord, items: newItems });
  };

  // Payment amount/method were only ever rendered as static spans, even in
  // edit mode — this is the same field-on-editRecord pattern handleItemChange
  // uses for sale/purchase lines, applied to the payment's own scalar fields.
  const handlePaymentField = <K extends keyof ParsedRecord>(field: K, value: ParsedRecord[K]) => {
    setEditRecord({ ...editRecord, [field]: value });
  };

  const handleAllocationChange = (index: number, field: keyof NormalizedAllocation, value: string | number) => {
    const newAllocations = [...(editRecord.allocations || [])];
    newAllocations[index] = { ...newAllocations[index], [field]: value };
    setEditRecord({ ...editRecord, allocations: newAllocations });
  };

  const addAllocation = () => {
    setEditRecord({ ...editRecord, allocations: [...(editRecord.allocations || []), { invoiceNumber: '', amount: 0 }] });
  };

  const removeAllocation = (index: number) => {
    setEditRecord({ ...editRecord, allocations: (editRecord.allocations || []).filter((_, i) => i !== index) });
  };

  const displayAllocations = isEditing ? editRecord.allocations : record.allocations;
  const showAllocations = isEditing || Boolean(record.allocations && record.allocations.length > 0);

  return (
    <div className={`glass rounded-xl overflow-hidden mb-4 animate-slide-up border-l-4 record-${record.type} ${isVoided ? 'opacity-50 grayscale' : ''}`}>
      <div className="p-4 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--bg-card)]">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">
              {label} - {partyDisplayName}
            </h4>
            <span className="text-xs text-[var(--text-muted)]">{record.date || new Date().toISOString().split('T')[0]}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {record.currency && record.currency !== 'AED' && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/60 font-semibold">
              {record.currency}
            </span>
          )}
          {record.exchangeRate && record.currency && record.currency !== 'AED' && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-700/60" title="Exchange rate used for this transaction">
              Rate: 1 {record.currency} = {record.exchangeRate} AED
            </span>
          )}
          {record.subtype === 'lumpSum' && isSaleOrPurchase && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/60" title="Single lump-sum line, not itemised">
              {locale === 'ar' ? 'مبلغ إجمالي' : 'Lump sum'}
            </span>
          )}
          {record.reverseCharge && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-900/40 text-purple-300 border border-purple-700/60">Reverse Charge</span>
          )}
          {record.items.some((item) => item.category === 'zero') && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-300 border border-gray-700">Zero-rated</span>
          )}
          {record.items.some((item) => item.category === 'exempt') && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-300 border border-gray-700">Exempt</span>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* Blocking problems. Shown instead of a silently empty card body. */}
        {errors.length > 0 && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm">
            <div className="font-semibold text-red-300 mb-1">
              {locale === 'ar' ? 'لا يمكن ترحيل هذا السجل' : 'This record cannot be posted'}
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-red-200/90">
              {errors.map((error, i) => <li key={i}>{error}</li>)}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-950/25 p-3 text-xs">
            <div className="font-semibold text-amber-300 mb-1">
              {locale === 'ar' ? 'يرجى المراجعة' : 'Please review'}
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-amber-200/90">
              {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
            </ul>
          </div>
        )}

        {/* A sale/purchase with no lines used to render an entirely blank body. */}
        {isSaleOrPurchase && !hasItems && (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center text-sm text-[var(--text-muted)]">
            {locale === 'ar'
              ? 'لم يتم استخراج أي بنود. اضغط على تعديل لإضافة الكمية والسعر.'
              : 'No line items were extracted. Use Edit to add a quantity and price, or rephrase with the amount.'}
          </div>
        )}

        {isSaleOrPurchase && hasItems && (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="pb-2 font-medium">{t('record.description') || 'Description'}</th>
                  <th className="pb-2 font-medium text-right">{t('record.quantity') || 'Qty'}</th>
                  <th className="pb-2 font-medium text-right">{t('record.unitPrice') || 'Price'}</th>
                  <th className="pb-2 font-medium text-right">{t('record.discount') || 'Discount'}</th>
                  <th className="pb-2 font-medium text-right">{t('record.lineTotal') || 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {(isEditing ? editRecord.items : record.items)?.map((item, idx) => {
                  const q = item.qty ?? 1;
                  const p = item.price ?? 0;
                  const d = item.discount ?? 0;
                  const lineTotal = (q * p) - d;

                  return (
                    <tr key={idx} className="border-b border-[var(--border-subtle)] last:border-0 odd:bg-[var(--bg-primary)] even:bg-[var(--bg-secondary)]">
                      <td className="py-2 px-1">
                        {isEditing ? (
                          <input type="text" value={item.description} onChange={(e) => handleItemChange(idx, 'description', e.target.value)} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
                        ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{item.description}</span>}
                      </td>
                      <td className="py-2 px-1 text-right">
                        {isEditing ? (
                          <input type="number" value={item.qty} onChange={(e) => handleItemChange(idx, 'qty', parseFloat(e.target.value))} className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                        ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{q}</span>}
                      </td>
                      <td className="py-2 px-1 text-right">
                        {isEditing ? (
                          <input type="number" value={item.price} onChange={(e) => handleItemChange(idx, 'price', parseFloat(e.target.value))} className="w-24 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                        ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency(p, '')}</span>}
                      </td>
                      <td className="py-2 px-1 text-right">
                        {isEditing ? (
                          <input type="number" value={item.discount || 0} onChange={(e) => handleItemChange(idx, 'discount', parseFloat(e.target.value))} className="w-24 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                        ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency(d, '')}</span>}
                      </td>
                      <td className="py-2 px-1 text-right font-medium">
                        <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency(lineTotal, '')}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {record.type === 'employee' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--text-muted)] block">{t('record.name')}</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.name || t('record.employeeFallback')}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">{t('record.position')}</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.position || t('record.staffFallback')}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">{t('record.basicSalary')}</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.basicSalary ?? 0, record.currency)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">{t('record.allowances')}</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.allowances ?? 0, record.currency)}</span>
            </div>
          </div>
        )}

        {record.type === 'asset' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">{t('record.assetName')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.assetName || t('record.assetFallback')}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.supplier')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.supplier || t('record.supplierFallback')}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.cost')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.purchaseCost ?? 0, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.usefulLife')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.usefulLifeYears ?? 5} {t('record.years')}</span></div>
          </div>
        )}

        {record.type === 'relatedParty' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">{t('record.party')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{partyDisplayName}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.relationship')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.relationship || t('record.relatedEntityFallback')}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.transactionType')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.transactionType || t('record.otherFallback')}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.amount')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.amount ?? 0, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">{t('record.armsLength')}</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{(record.isArmsLength ?? true) ? t('record.yes') : t('record.no')}</span></div>
          </div>
        )}

        {record.type === 'payment' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[var(--text-muted)] block">{t('record.party')}</span>
                <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{partyDisplayName}</span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">{t('record.direction')}</span>
                <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>
                  {record.paymentType === 'sent' ? t('record.sent') : t('record.received')}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block">{t('record.paymentMethod')}</span>
                {isEditing ? (
                  <select
                    value={editRecord.paymentMethod || 'bank_transfer'}
                    onChange={(e) => handlePaymentField('paymentMethod', e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]"
                  >
                    <option value="bank_transfer">{t('record.paymentMethods.bank_transfer')}</option>
                    <option value="cash">{t('record.paymentMethods.cash')}</option>
                    <option value="cheque">{t('record.paymentMethods.cheque')}</option>
                    <option value="card">{t('record.paymentMethods.card')}</option>
                  </select>
                ) : (
                 
