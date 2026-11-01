   
                               
              
   

import { DOMSimHash } from './dom-simhash.js';
import type { ElementNode } from '../types/outline.js';

export interface ListPattern {
  type: 'semantic' | 'structural';                                 
  start: number;                             
  end: number;                               
  count: number;                            
  sample: ElementNode;                           
  items: ElementNode[];                     
  refs: string[];                           
}

export class ListDetector {
  private simhash = new DOMSimHash();
  
     
             
     
  detectLists(nodes: ElementNode[]): ListPattern[] {
    const lists: ListPattern[] = [];
    
                               
    const semanticLists = this.detectSemanticLists(nodes);
    lists.push(...semanticLists);
    
                         
    const structuralLists = this.detectStructuralLists(nodes, semanticLists);
    lists.push(...structuralLists);
    
               
    lists.sort((a, b) => a.start - b.start);
    
    return lists;
  }
  
     
                           
     
  private detectSemanticLists(nodes: ElementNode[]): ListPattern[] {
    const lists: ListPattern[] = [];
    let currentList: ElementNode[] = [];
    let startIdx = -1;
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      if (node.type === 'listitem') {
        if (currentList.length === 0) {
          startIdx = i;
        }
        currentList.push(node);
      } else {
                 
        if (currentList.length >= 3) {
                               
          const similar = this.findStructurallySimilar(currentList);
          
          if (similar) {
            lists.push({
              type: 'semantic',
              start: startIdx + similar.start,
              end: startIdx + similar.end,
              count: similar.count,
              sample: similar.sample,
              items: similar.items,
              refs: similar.items.map(n => n.ref).filter(r => r)
            });
          } else {
                            
            lists.push({
              type: 'semantic',
              start: startIdx,
              end: startIdx + currentList.length - 1,
              count: currentList.length,
              sample: currentList[0],
              items: currentList,
              refs: currentList.map(n => n.ref).filter(r => r)
            });
          }
        }
        currentList = [];
        startIdx = -1;
      }
    }
    
              
    if (currentList.length >= 3) {
      const similar = this.findStructurallySimilar(currentList);
      if (similar) {
        lists.push({
          type: 'semantic',
          start: startIdx + similar.start,
          end: startIdx + similar.end,
          count: similar.count,
          sample: similar.sample,
          items: similar.items,
          refs: similar.items.map(n => n.ref).filter(r => r)
        });
      }
    }
    
    return lists;
  }
  
     
                     
     
  private detectStructuralLists(nodes: ElementNode[], semanticLists: ListPattern[]): ListPattern[] {
    const lists: ListPattern[] = [];
    const processed = new Set<number>();
    
                   
    for (const list of semanticLists) {
      for (let i = list.start; i <= list.end; i++) {
        processed.add(i);
      }
    }
    
            
    const indentGroups = new Map<number, {node: ElementNode, index: number}[]>();
    
    for (let i = 0; i < nodes.length; i++) {
      if (processed.has(i)) continue;
      
      const node = nodes[i];
      const indent = node.indent;
      
      if (!indentGroups.has(indent)) {
        indentGroups.set(indent, []);
      }
      
      indentGroups.get(indent)!.push({node, index: i});
    }
    
                       
    for (const [indent, group] of indentGroups.entries()) {
      if (group.length < 3) continue;
      
               
      const groupNodes = group.map(g => g.node);
      const sequences = this.simhash.findAllSimilarSequences(groupNodes);
      
      for (const seq of sequences) {
                  
        const startIdx = group[seq.start].index;
        const endIdx = group[seq.end].index;
        const items = group.slice(seq.start, seq.end + 1).map(g => g.node);
        
        lists.push({
          type: 'structural',
          start: startIdx,
          end: endIdx,
          count: seq.count,
          sample: seq.sample,
          items: items,
          refs: items.map(n => n.ref).filter(r => r)
        });
      }
    }
    
    return lists;
  }
  
     
               
     
  private findStructurallySimilar(nodes: ElementNode[]): {
    start: number;
    end: number;
    count: number;
    sample: ElementNode;
    items: ElementNode[];
  } | null {
    const seq = this.simhash.findSimilarSequence(nodes);
    
    if (!seq) return null;
    
    return {
      start: seq.start,
      end: seq.end,
      count: seq.end - seq.start + 1,
      sample: nodes[seq.start],
      items: seq.samples
    };
  }
  
     
           
     
  detectNestedLists(node: ElementNode): ListPattern[] {
    const lists: ListPattern[] = [];
    
                  
    if (node.children.length >= 3) {
      const childLists = this.detectLists(node.children);
      lists.push(...childLists);
    }
    
                 
    for (const child of node.children) {
      const nestedLists = this.detectNestedLists(child);
      lists.push(...nestedLists);
    }
    
    return lists;
  }
  
     
                 
     
  isPartOfList(node: ElementNode, lists: ListPattern[]): ListPattern | null {
    for (const list of lists) {
      if (list.items.includes(node)) {
        return list;
      }
    }
    return null;
  }
}