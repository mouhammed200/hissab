'use client';

import React, { useState } from 'react';

// Defining types internally to avoid dependency issues if they are not yet fully typed in the external file
export interface ParsedItem {
  description: string;
  qty: number;
  price: number;
  discount?: number;
  category?: 'standard' | 'zero' | 'exempt' | 'outOfScope';
}

export interface ParsedRecord {
  type: 'sale' | 'purchase' | 'employee' | 'asset' | 'relatedParty' | 'query' | 'action';
  partyName?: string;
  date?: string;
  items?: ParsedItem[];
  employeeDetails?: {
    name: string;
    position: string;
    basicSalary: number;
    allowances: number;
    hireDate: string;
    contractType: string;
  };
  assetDetails?: {
    name: string;
    cost: number;
    salvageValue: number;
    usefulLife: number;
    supplier: string;
  };
  relatedPartyDetails?: {
    party: string;
    relationship: string;
    amount: number;
    isArmsLength: boolean;
  };
  currency?: string;
  exchangeRate?: number;
  amountInAED?: number;
  vatInAED?: number;
  reverseCharge?: boolean;
  vatCategory?: string;
}

export interface RecordTotals {
  subtotal: number;
  vat: number;
  discount: number;
  total: number;
}

interface RecordCardProps {
  record: ParsedRecord;
  totals?: RecordTotals;
  status: 'pending' | 'confirmed' | 'voided' | 'editing';
  onConfirm: () => void;
  onVoid: () => void;
  onEdit: () => void;
  onSaveEdit: (updated: ParsedRecord) => void;
  onCancelEdit: () => void;
}

const formatCurrency = (amount: number, currency: string = 'AED') => {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(amount) + ` ${currency}`;
};

export default function RecordCard({
  record,
  totals,
  status,
  onConfirm,
  onVoid,
  onEdit,
  onSaveEdit,
  onCancelEdit
}: RecordCardProps) {
  const [editRecord, setEditRecord] = useState<ParsedRecord>(record);

  const getIconAndLabel = () => {
    switch (record.type) {
      case 'sale': return { icon: '💰', label: 'Sale' };
      case 'purchase': return { icon: '🛒', label: 'Purchase' };
      case 'employee': return { icon: '👤', label: 'Employee' };
      case 'asset': return { icon: '🏢', label: 'Asset' };
      case 'relatedParty': return { icon: '🔗', label: 'Related Party' };
      default: return { icon: '📄', label: 'Record' };
    }
  };

  const { icon, label } = getIconAndLabel();
  const isEditing = status === 'editing';
  const isVoided = status === 'voided';
  
  const handleItemChange = (index: number, field: keyof ParsedItem, value: any) => {
    const newItems = [...(editRecord.items || [])];
    newItems[index] = { ...newItems[index], [field]: value };
    setEditRecord({ ...editRecord, items: newItems });
  };

  const handleEmployeeChange = (field: string, value: any) => {
    setEditRecord({
      ...editRecord,
      employeeDetails: { ...editRecord.employeeDetails!, [field]: value }
    });
  };

  return (
    <div className={`glass rounded-xl overflow-hidden mb-4 animate-slide-up border-l-4 record-${record.type} ${isVoided ? 'opacity-50 grayscale' : ''}`}>
      <div className="p-4 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--bg-card)]">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">
              {label} - {record.partyName || record.employeeDetails?.name || record.assetDetails?.name || record.relatedPartyDetails?.party || 'Unknown'}
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
            <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-700/60" title="CBUAE Official Rate">
              CBUAE: 1 {record.currency} = {record.exchangeRate} AED
            </span>
          )}
          {record.reverseCharge && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-900/40 text-purple-300 border border-purple-700/60">Reverse Charge</span>
          )}
          {record.vatCategory && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-800 text-gray-300 border border-gray-700">{record.vatCategory}</span>
          )}
        </div>
      </div>

      <div className="p-4">
        {(record.type === 'sale' || record.type === 'purchase') && record.items && (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="pb-2 font-medium">Description</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium text-right">Price</th>
                  <th className="pb-2 font-medium text-right">Discount</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(isEditing ? editRecord.items : record.items)?.map((item, idx) => (
                  <tr key={idx} className="border-b border-[var(--border-subtle)] last:border-0 odd:bg-[var(--bg-primary)] even:bg-[var(--bg-secondary)]">
                    <td className="py-2 px-1">
                      {isEditing ? (
                        <input type="text" value={item.description} onChange={(e) => handleItemChange(idx, 'description', e.target.value)} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
                      ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{item.description}</span>}
                    </td>
                    <td className="py-2 px-1 text-right">
                      {isEditing ? (
                        <input type="number" value={item.qty} onChange={(e) => handleItemChange(idx, 'qty', parseFloat(e.target.value))} className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                      ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{item.qty}</span>}
                    </td>
                    <td className="py-2 px-1 text-right">
                      {isEditing ? (
                        <input type="number" value={item.price} onChange={(e) => handleItemChange(idx, 'price', parseFloat(e.target.value))} className="w-24 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                      ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency(item.price, '')}</span>}
                    </td>
                    <td className="py-2 px-1 text-right">
                      {isEditing ? (
                        <input type="number" value={item.discount || 0} onChange={(e) => handleItemChange(idx, 'discount', parseFloat(e.target.value))} className="w-24 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)] text-right" />
                      ) : <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency(item.discount || 0, '')}</span>}
                    </td>
                    <td className="py-2 px-1 text-right font-medium">
                      <span className={isVoided ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}>{formatCurrency((item.qty * item.price) - (item.discount || 0), '')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {record.type === 'employee' && record.employeeDetails && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--text-muted)] block">Name</span>
              {isEditing ? (
                <input type="text" value={editRecord.employeeDetails?.name} onChange={(e) => handleEmployeeChange('name', e.target.value)} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
              ) : <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.employeeDetails.name}</span>}
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Position</span>
              {isEditing ? (
                <input type="text" value={editRecord.employeeDetails?.position} onChange={(e) => handleEmployeeChange('position', e.target.value)} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
              ) : <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.employeeDetails.position}</span>}
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Basic Salary</span>
              {isEditing ? (
                <input type="number" value={editRecord.employeeDetails?.basicSalary} onChange={(e) => handleEmployeeChange('basicSalary', parseFloat(e.target.value))} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
              ) : <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.employeeDetails.basicSalary, record.currency)}</span>}
            </div>
            <div>
              <span className="text-[var(--text-muted)] block">Allowances</span>
              {isEditing ? (
                <input type="number" value={editRecord.employeeDetails?.allowances} onChange={(e) => handleEmployeeChange('allowances', parseFloat(e.target.value))} className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-primary)]" />
              ) : <span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.employeeDetails.allowances, record.currency)}</span>}
            </div>
          </div>
        )}

        {record.type === 'asset' && record.assetDetails && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">Name</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.assetDetails.name}</span></div>
            <div><span className="text-[var(--text-muted)] block">Supplier</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.assetDetails.supplier}</span></div>
            <div><span className="text-[var(--text-muted)] block">Cost</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.assetDetails.cost, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">Useful Life</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.assetDetails.usefulLife} years</span></div>
          </div>
        )}

        {record.type === 'relatedParty' && record.relatedPartyDetails && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--text-muted)] block">Party</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.relatedPartyDetails.party}</span></div>
            <div><span className="text-[var(--text-muted)] block">Relationship</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.relatedPartyDetails.relationship}</span></div>
            <div><span className="text-[var(--text-muted)] block">Amount</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{formatCurrency(record.relatedPartyDetails.amount, record.currency)}</span></div>
            <div><span className="text-[var(--text-muted)] block">Arm's Length</span><span className={`text-[var(--text-primary)] ${isVoided ? 'line-through' : ''}`}>{record.relatedPartyDetails.isArmsLength ? 'Yes' : 'No'}</span></div>
          </div>
        )}
      </div>

      {(totals || (record.type === 'employee' && record.employeeDetails)) && (
        <div className="p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] flex flex-col gap-1">
          {totals ? (
            <>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>Subtotal</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.subtotal, record.currency)}</span></div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>Discount</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.discount, record.currency)}</span></div>
              <div className="flex justify-between text-sm text-[var(--text-secondary)]"><span>VAT Amount</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.vat, record.currency)}</span></div>
              <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 pt-1 border-t border-[var(--border-subtle)]"><span>Total</span><span className={isVoided ? 'line-through' : ''}>{formatCurrency(totals.total, record.currency)}</span></div>
              
              {/* Mandatory FTA Foreign Currency Breakdown */}
              {record.currency && record.currency !== 'AED' && record.amountInAED !== undefined && (
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
          ) : record.type === 'employee' && record.employeeDetails ? (
             <div className="flex justify-between font-bold text-[var(--text-primary)] mt-1 pt-1 border-t border-[var(--border-subtle)]">
               <span>Total Package</span>
               <span className={isVoided ? 'line-through' : ''}>
                 {formatCurrency((record.employeeDetails.basicSalary || 0) + (record.employeeDetails.allowances || 0), record.currency)}
               </span>
             </div>
          ) : null}
        </div>
      )}

      <div className="p-4 flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]">
        {status === 'pending' && (
          <>
            <button onClick={onVoid} className="px-4 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors">Dismiss</button>
            <button onClick={onEdit} className="px-4 py-2 text-sm text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors">Edit</button>
            <button onClick={onConfirm} className="px-4 py-2 text-sm btn-primary bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors">Confirm</button>
          </>
        )}
        {status === 'confirmed' && (
          <>
            <div className="flex items-center text-[var(--accent)] mr-auto">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span className="text-sm font-medium">Confirmed</span>
            </div>
            <button onClick={onVoid} className="px-4 py-2 text-sm text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors">Void</button>
          </>
        )}
        {status === 'editing' && (
          <>
            <button onClick={() => { setEditRecord(record); onCancelEdit(); }} className="px-4 py-2 text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">Cancel</button>
            <button onClick={() => onSaveEdit(editRecord)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">Save</button>
          </>
        )}
        {status === 'voided' && (
          <div className="text-sm text-[var(--text-muted)] italic font-medium w-full text-center">This record has been voided</div>
        )}
      </div>
    </div>
  );
}
