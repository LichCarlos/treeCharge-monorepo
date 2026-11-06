import type React from 'react';
import type {Icon} from './ui';
import {resolveCategoryIcon} from '@charge/categories';
export {categoryIcons,inferCategoryIcon,resolveCategoryIcon} from '@charge/categories';
export function categoryIcon(category:any):React.ComponentProps<typeof Icon>['name']{return resolveCategoryIcon(category).glyph as React.ComponentProps<typeof Icon>['name'];}
