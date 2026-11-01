   
                    
        
                     
                        
   

import type { ElementNode } from '../types/outline.js';

export class UselessWrapperRemover {
     
                 
     
  removeWrappers(nodes: ElementNode[]): ElementNode[] {
                
    nodes = this.removeEmptyGenerics(nodes);
                 
    return nodes.map(node => this.processNode(node));
  }
  
     
                    
     
  private removeEmptyGenerics(nodes: ElementNode[]): ElementNode[] {
    const result: ElementNode[] = [];
    
    for (const node of nodes) {
                 
      if (node.children.length > 0) {
        node.children = this.removeEmptyGenerics(node.children);
      }
      
                       
      if (this.isEmptyGeneric(node)) {
                        
        continue;
      }
      
      result.push(node);
    }
    
    return result;
  }
  
     
                    
     
  private isEmptyGeneric(node: ElementNode): boolean {
    return (
      node.type === 'generic' &&
      node.children.length === 0 &&
      !node.content               
    );
  }
  
     
           
     
  private processNode(node: ElementNode): ElementNode {
               
    if (node.children.length > 0) {
      node.children = this.removeWrappers(node.children);
    }
    
                 
    while (this.isUselessWrapper(node)) {
      const onlyChild = node.children[0];
      
               
      this.mergeAttributes(node, onlyChild);
      
                 
      node = onlyChild;
      
                  
      if (node.children.length > 0) {
        node.children = this.removeWrappers(node.children);
      }
    }
    
    return node;
  }
  
     
               
     
  private isUselessWrapper(node: ElementNode): boolean {
    return (
      node.type === 'generic' &&
      node.children.length === 1
    );
  }
  
     
                   
     
  private mergeAttributes(parent: ElementNode, child: ElementNode): void {
           
    child.indent = parent.indent;
    
                 
    if (parent.parent) {
      child.parent = parent.parent;
    }
    
                                    
    if (parent.content && !child.content) {
      child.content = parent.content;
    }
  }
  
     
             
     
  countRemovedLayers(originalNodes: ElementNode[], processedNodes: ElementNode[]): number {
    let removedCount = 0;
    
    const countDepth = (node: ElementNode): number => {
      let depth = 1;
      if (node.children.length > 0) {
        depth += Math.max(...node.children.map(countDepth));
      }
      return depth;
    };
    
    const originalDepth = Math.max(...originalNodes.map(countDepth));
    const processedDepth = Math.max(...processedNodes.map(countDepth));
    
    removedCount = originalDepth - processedDepth;
    
    return removedCount;
  }
}