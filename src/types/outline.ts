/**
 * Smart Outline Generation System Types
 */

export interface ElementNode {
  indent: number;
  type: string;
  ref: string;
  content: string;
  line: string;          
  children: ElementNode[];
  priority: number;               
  isRepetitive: boolean;
  groupId?: string;           
  lineNumber: number;        
  parent?: ElementNode;
  hasInteraction?: boolean;
}

export interface ElementGroup {
  type: string;
  indent: number;
  count: number;
  firstElement: ElementNode;
  samples: ElementNode[];             
  refs: string[];                     
  startLine: number;
  endLine: number;
}

export interface PageStructure {
  nodes: Map<string, ElementNode>;
  nodesByLine: Map<number, ElementNode>;
  groups: ElementGroup[];
  priorityQueue: ElementNode[];
  totalLines: number;
  rootNodes: ElementNode[];
}

export interface OutlineOptions {
  maxLines: number;
  mode: 'smart' | 'simple';
  preserveStructure: boolean;
  foldThreshold: number;         
}