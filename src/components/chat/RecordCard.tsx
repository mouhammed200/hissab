'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/locale';
import type { NormalizedItem, NormalizedRecord, RecordTotals } from '@/lib/records/normalize';

// Record shape and totals are defined once, in the shared normalizer, so the
// card can never disagree with what the posting route will actually write.
export type ParsedItem = NormalizedItem
export type ParsedRecord = NormalizedRecord
export type { RecordTotals }

interface RecordCardProps {
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

  const getIconAndLabel = () => {
    switch (record.type) {
      case 'sale': return { icon: '💰', label: locale === 'ar' ? 'مبيعات' : 'Sale' };
      case 'purchase': return { icon: '🛒', label: locale === 'ar' ? 'مشتريات' : 'Purchase' };
      case 'employee': return { icon: '👤', label: locale === 'ar' ? 'موظف' : 'Employee' };
      case 'asset': return { icon: '🏢', label: locale === 'ar' ? 'أصل ثابت' : 'Fixed Asset' };
      case 'relatedParty': return { icon: '🔗', label: locale === 'ar' ? 'طرف ذو صلة' : 'Related Party' };
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
              <span className="text-[var(--text-muted)] block">Name</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.name || 'Employee'}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Position</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.position || 'Staff'}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Basic Salary</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.basicSalary ?? 0, record.currency)}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Allowances</span>
              <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.allowances ?? 0, record.currency)}</span>
            </div>
          </div>
        )}

        {record.type === 'asset' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">Name</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.assetName || 'Asset'}</span></div>
            <div><span className="text-[var(--text-muted)] block">Supplier</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.supplier || 'Supplier'}</span></div>
            <div><span className="text-[var(--text-muted)] block">Cost</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.purchaseCost ?? 0, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">Useful Life</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.usefulLifeYears ?? 5} years</span></div>
          </div>
        )}

        {record.type === 'relatedParty' && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">Party</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{partyDisplayName}</span></div>
            <div><span className="text-[var(--text-muted)] block">Relationship</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.relationship || 'Related Entity'}</span></div>
            <div><span className="text-[var(--text-muted)] block">Transaction</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.transactionType || 'Other'}</span></div>
            <div><span className="text-[var(--text-muted)] block">Amount</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.amount ?? 0, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">Arms-length</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{(record.isArmsLength ?? true) ? 'Yes' : 'No'}</span></div>
          </div>
        )}
      </div>

      {(totals || record.type === 'employee') && (
        <div className="p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] flex flex-col gap-1">
          {totals ? (
            <>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>{t('record.subtotal') || 'Subtotal'}</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.subtotal, record.currency)}</span></div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>{t('record.discount') || 'Discount'}</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.discount, record.currency)}</span></div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>{t('record.vat') || 'VAT Amount'}</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.vat, record.currency)}</span></div>
              <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 pt-1 border-t border-[var(--border-subtle)]"><span>{t('record.total') || 'Total'}</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.total, record.currency)}</span></div>
              
              {/* Mandatory FTA Foreign Currency Breakdown */}
              {record.currency !== 'AED' && record.amountInAED === undefined && (
                <div className="mt-2 pt-2 border-t border-amber-500/20 bg-amber-950/20 p-2.5 rounded-lg text-xs text-amber-200">
                  No CBUAE rate was applied to this {record.currency} record. It cannot be posted to the AED ledger until a rate is available.
                </div>
              )}

              {record.currency !== 'AED' && record.amountInAED !== undefined && (
                <div className="mt-2 pt-2 border-t border-emerald-500/20 bg-emerald-950/20 p-2.5 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-emerald-400 flex justify-between">
                    <span>🏛️ FTA Converted AED Breakdown</span>
                    <span>1 {record.currency} = {record.exchangeRate} AED</span>
                  </div>
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Subtotal (AED):</span>
                    <span>{formatCurrency(record.amountInAED, 'AED')}</span>
                  </div>
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>VAT 5% (AED):</span>
                    <span>{formatCurrency(record.vatInAED || 0, 'AED')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-300">
                    <span>Total Tax Invoice (AED):</span>
                    <span>{formatCurrency((record.amountInAED || 0) + (record.vatInAED || 0), 'AED')}</span>
                  </div>
                </div>
              )}
            </>
          ) : record.type === 'employee' ? (
             <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 pt-1 border-t border-[var(--border-subtle)]">
               <span>Total Package</span>
               <span className={isVoided ? 'line-through' : ''}>
                 {formatCurrency(((record.basicSalary ?? 0) + (record.allowances ?? 0)), record.currency)}
               </span>
             </div>
          ) : null}
        </div>
      )}

      <div className="p-4 flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
        {status === 'pending' && (
          <>
            <button onClick={() => onVoid()} className="px-4 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors">{t('record.cancel') || 'Dismiss'}</button>
            <button onClick={onEdit} className="px-4 py-2 text-sm text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors">{t('record.edit') || 'Edit'}</button>
            <button
              onClick={onConfirm}
              disabled={blocking}
              title={blocking ? errors[0] : undefined}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                blocking
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed'
                  : 'btn-primary bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
              }`}
            >
              {t('record.confirm') || 'Confirm'}
            </button>
          </>
        )}
        {status === 'confirmed' && (
          <>
            <div className="flex items-center text-[var(--accent)] mr-auto">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span className="text-sm font-medium">{t('record.confirmed') || 'Confirmed'}</span>
            </div>
            {canVoid && (
              <button onClick={() => setShowVoidModal(true)} className="px-4 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors">{t('record.void') || 'Void'}</button>
            )}
          </>
        )}
        {status === 'editing' && (
          <>
            <button onClick={() => { setEditRecord(record); onCancelEdit(); }} className="px-4 py-2 text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">{t('record.cancel') || 'Cancel'}</button>
            <button onClick={() => onSaveEdit(editRecord)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">{t('record.save') || 'Save'}</button>
          </>
        )}
        {status === 'voided' && (
          <div className="text-sm text-[var(--text-muted)] italic font-medium w-full text-center">{t('record.voided') || 'This record has been voided'}</div>
        )}
      </div>

      {showVoidModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-reason-title"
        >
          <div className="glass rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] w-full max-w-sm p-4">
            <h3 id="void-reason-title" className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('record.voidReasonTitle')}
            </h3>
            <textarea
              autoFocus
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t('record.voidReasonPlaceholder')}
              className="w-full min-h-[80px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm p-2 mb-3 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowVoidModal(false); setVoidReason(''); }}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {t('record.cancel') || 'Cancel'}
              </button>
              <button
                onClick={() => {
                  const reason = voidReason.trim();
                  if (!reason) return;
                  setShowVoidModal(false);
                  setVoidReason('');
                  onVoid(reason);
                }}
                disabled={!voidReason.trim()}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  voidReason.trim()
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)] cursor-not-allowed'
                }`}
              >
                {t('record.void') || 'Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
